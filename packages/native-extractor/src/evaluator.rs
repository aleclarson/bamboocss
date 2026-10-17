use std::{
    borrow::Cow,
    cell::{Cell, RefCell},
    collections::{HashMap, HashSet},
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};

use oxc_allocator::Allocator;
use oxc_ast::{
    AstKind,
    ast::{
        Argument, ArrowFunctionBody, ArrowFunctionExpression, BindingPattern, CallExpression,
        Declaration, Expression, FormalParameters, Function, ImportDeclarationSpecifier,
        JSXExpression, LogicalExpression, ModuleExportName, ObjectPropertyKind, Statement,
    },
};
use oxc_parser::Parser;
use oxc_semantic::{AstNodes, NodeId, Scoping, Semantic, SemanticBuilder};
use oxc_span::{GetSpan, SourceType};
use oxc_syntax::{
    operator::{BinaryOperator, LogicalOperator, UnaryOperator},
    symbol::{SymbolFlags, SymbolId},
};

use crate::{NativeEntrypoint, NativePathMapping, NativeProjectOptions, NativeToken};

/// How deeply helper calls may nest before the evaluator stops following them, so a recursion
/// that does not end stops before the stack does. Real helpers nest a handful.
/// See `FileEvaluator::enter_call`.
///
/// Measured with a recursion only this limit stops, a level holding nested objects, arrays,
/// ternaries and a template literal, in a worker given a fixed stack: a release build holds all 64
/// levels in 0.5 MB; a debug build overflows 3 MB and holds them in 4 MB, Node's default for a
/// worker, so it has no room to spare there. The main thread has 8 MB, on Windows too since
/// Node 19 reserves that much (the packages require 22.12).
const MAX_CALL_DEPTH: u32 = 64;

/// How many helper calls one outermost call may make. Depth does not bound a recursion that
/// branches: a helper calling itself twice per level makes `2^depth` calls. Real helpers make a
/// few dozen.
const MAX_CALLS: u32 = 10_000;

/// Code the evaluator will not run, and where — the reason an unknown value is unknown.
///
/// Most unknowns explain themselves at the call: a parameter, a prop, an import the build
/// cannot read. A refusal does not. The statement is in a helper's body, which may be in another
/// file, and a write to a binding may be anywhere in its module, so the call site alone gives the
/// author nothing to change. Carried with the value, through the caches that hold it.
#[derive(Clone, Debug)]
pub(crate) struct Refusal {
    /// `statement`: a helper's body uses one the evaluator does not run.
    /// `write`: a binding is reassigned or written into after its declaration.
    /// `recursion`: a helper call it does not follow — see `FileEvaluator::enter_call`.
    pub kind: &'static str,
    /// For `statement`, its keyword — `switch`, `for…of`, `throw` — or `expression` for one run
    /// for its effect. For `write`, the binding's name. For `recursion`, why: `loop`, `depth` or
    /// `calls` — see `FileEvaluator::enter_call` — or `module`, see `ProjectEvaluator::call_export`.
    pub subject: String,
    /// For `statement`, the helper whose body it is in, when it has a name. For `recursion`, the
    /// recursive helper, which is also where the refusal points.
    pub helper: Option<String>,
    /// The statement, or the one making the write, as written: its first line, shortened.
    pub excerpt: String,
    pub file_path: String,
    pub line: u32,
    pub column: u32,
}

/// What is still known of an object the evaluator could not wholly evaluate, property by
/// property.
///
/// An object is incomplete as soon as one property is — a call the build cannot run, a spread of
/// something unknown — and that says nothing about the others. Reading one of them,
/// `theme.radius` beside `shadow: computeShadow()`, used to fail as if it were the unknown one.
/// Recorded only for an incomplete object, so a complete one costs nothing.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Partial {
    /// A spread or computed key the evaluator could not resolve: it may have written any
    /// property, so only those written after it are known.
    open: bool,
    /// While `open`: the properties written completely since the last such write.
    settled: HashSet<String>,
    /// Otherwise: the properties whose last write was not complete.
    unsettled: HashSet<String>,
    /// What is known of a property whose value is itself an incomplete object.
    children: HashMap<String, Arc<Partial>>,
    /// The properties holding `null` that may be `undefined`: an array's holes and `undefined`
    /// elements, and what was read from one.
    nullish: HashSet<String>,
    /// The properties written as `undefined`, which the value leaves out. A spread of the object,
    /// or `Object.assign` from it, writes them over what was there: `{ ...defaults, size:
    /// undefined }` clears the default, as it does at runtime.
    undefined: HashSet<String>,
    /// For an array opened after a spread of unknown length: how many elements came before it,
    /// which are still where they are held.
    known_prefix: usize,
}

impl Partial {
    /// Whether `property` holds exactly what the object says it holds, written or not.
    fn knows(&self, property: &str) -> bool {
        if self.open {
            self.settled.contains(property)
                || array_index(property).is_some_and(|index| {
                    index < self.known_prefix && !self.unsettled.contains(property)
                })
        } else {
            !self.unsettled.contains(property)
        }
    }

    fn write(&mut self, property: &str, complete: bool, child: Option<Arc<Partial>>) {
        self.nullish.remove(property);
        self.undefined.remove(property);
        if complete {
            self.unsettled.remove(property);
            if self.open {
                self.settled.insert(property.to_string());
            }
        } else {
            self.unsettled.insert(property.to_string());
            self.settled.remove(property);
        }
        match child {
            Some(child) => {
                self.children.insert(property.to_string(), child);
            }
            None => {
                self.children.remove(property);
            }
        }
    }

    /// A write the evaluator cannot attribute to a property. What was known of the properties
    /// written before it — that one held a `null` that may be `undefined`, what one held inside —
    /// may no longer be so.
    fn open(&mut self) {
        self.open = true;
        self.settled.clear();
        self.nullish.clear();
        self.children.clear();
        self.undefined.clear();
    }

    /// Code the evaluator could not follow ran after the value was made — `(track(), styles)` —
    /// and may have written to it, deleting a property as surely as writing one. Nothing it held
    /// stands, and of each property in `own` only that it was written with a value not known, so
    /// that `in` does not answer for it either.
    fn distrust<'k>(&mut self, own: impl IntoIterator<Item = &'k String>) {
        let mut written: HashSet<String> = own.into_iter().cloned().collect();
        written.extend(self.undefined.iter().cloned());
        self.open();
        self.known_prefix = 0;
        self.unsettled.extend(written);
    }

    /// A prototype set by `__proto__`: what it has, the object inherits, so a property it does
    /// not hold may be there. Unlike a spread it writes over nothing — a property the object holds
    /// shadows an inherited one — so each in `own`, and each written as `undefined`, stays as
    /// known as it was.
    fn inherit<'k>(&mut self, own: impl IntoIterator<Item = &'k String>) {
        if self.open {
            return;
        }
        let mut settled: HashSet<String> = own.into_iter().cloned().collect();
        settled.extend(self.undefined.iter().cloned());
        settled.retain(|key| !self.unsettled.contains(key));
        self.open = true;
        self.settled = settled;
    }

    /// An array's elements from `len` on are not where they are held, as a spread of unknown
    /// length came there; those before it still are.
    fn open_after(&mut self, len: usize) {
        if !self.open {
            self.open = true;
            self.known_prefix = len;
        }
    }

    /// Nothing said of `property`: the object a rest pattern makes is without it.
    fn forget(&mut self, property: &str) {
        self.unsettled.remove(property);
        self.settled.remove(property);
        self.children.remove(property);
        self.nullish.remove(property);
        self.undefined.remove(property);
    }

    /// A property written as `undefined`.
    fn write_undefined(&mut self, property: &str) {
        self.write(property, true, None);
        self.undefined.insert(property.to_string());
    }

    /// An object spread over the properties written so far: each of `keys`, known, with what the
    /// spread object said of it, then each it wrote as `undefined`.
    fn write_spread<'k>(
        &mut self,
        keys: impl IntoIterator<Item = &'k String>,
        source: Option<&Partial>,
    ) {
        for key in keys {
            if source.is_some_and(|source| source.nullish.contains(key)) {
                self.write_nullish(key);
            } else {
                let child = source.and_then(|source| source.children.get(key).cloned());
                self.write(key, true, child);
            }
        }
        if let Some(source) = source {
            for key in &source.undefined {
                self.write_undefined(key);
            }
        }
    }

    /// A property holding `null` that may be `undefined`.
    fn write_nullish(&mut self, property: &str) {
        self.write(property, true, None);
        self.nullish.insert(property.to_string());
    }

    /// Records what is known of one value written under `property`.
    fn write_value(&mut self, property: &str, value: &EvalResult) {
        if (value.nullish && value.complete) || value.is_undefined() {
            self.write_nullish(property);
        } else {
            let exact = value.complete && value.value.is_some();
            self.write(property, exact, value.partial.clone());
        }
    }

    /// Whether a `null` that may be `undefined` is held anywhere inside.
    fn holds_nullish(&self) -> bool {
        !self.nullish.is_empty() || self.children.values().any(|child| child.holds_nullish())
    }

    /// What this array's elements from `skip` on say, recorded in `into` from `offset`: an
    /// array spread into another, or what a rest element takes. A spread reads through the
    /// iterator, which turns a hole into `undefined`, held the same. Past an unknown length
    /// nothing is where it is held, so `into` is open from there.
    fn spread_into(&self, into: &mut Partial, skip: usize, offset: usize, len: usize) {
        // Opened itself, it says where its elements are only up to the spread that opened it.
        let bound = if self.open {
            len.min(self.known_prefix)
        } else {
            len
        };
        for position in skip..bound {
            let key = position.to_string();
            let target = (offset + position - skip).to_string();
            if self.nullish.contains(&key) {
                into.write_nullish(&target);
                continue;
            }
            let known = self.knows(&key);
            let child = self.children.get(&key).cloned();
            if !known || child.is_some() {
                into.write(&target, known, child);
            }
        }
        if self.open {
            into.open_after(offset + bound.saturating_sub(skip));
        }
    }

    /// Whether what it says leaves nothing of the value not known, inside it included: neither
    /// open nor holding a property it does not know. A `null` that may be `undefined` converts as
    /// either does, to nothing, in `join`.
    fn read_whole(&self) -> bool {
        !self.open
            && self.unsettled.is_empty()
            && self.children.values().all(|child| child.read_whole())
    }

    /// Whether every property is known and none holds an object known only in part, so there is
    /// nothing to record.
    fn is_empty(&self) -> bool {
        !self.open
            && self.unsettled.is_empty()
            && self.children.is_empty()
            && self.nullish.is_empty()
            && self.undefined.is_empty()
    }
}

#[derive(Clone, Debug)]
pub(crate) struct EvalResult {
    pub value: Option<serde_json::Value>,
    /// Fragments emitted for branches whose condition is not statically known.
    pub conditions: Vec<serde_json::Value>,
    pub complete: bool,
    /// Why the value is not known, when the evaluator refused something along the way.
    pub refusal: Option<Arc<Refusal>>,
    /// For an incomplete object, which of its properties are still known. One that is not open
    /// says every key the object has, so whatever lowers `complete` for a reason other than a
    /// property's value opens it: a spread it could not read, a prototype, code run for its effect
    /// alone — the left of a comma — that it could not follow. Code whose value is used, an unknown
    /// call among a helper's declarations, is taken to write to nothing, what it was given included.
    ///
    /// An incomplete object with no record at all is a guess as a whole: read where a spread may
    /// have written over it, it may not be this object, nor hold any key it holds.
    pub partial: Option<Arc<Partial>>,
    /// `null` or `undefined`, without knowing which: an array hole or `undefined` element, held as
    /// `null`. Complete for what the two agree on — `??`, `||`, a test, `?.` — and not to be
    /// converted, where `null` is 0 and `"null"` and `undefined` is `NaN` and `"undefined"`.
    pub nullish: bool,
}

impl EvalResult {
    fn known(value: impl Into<serde_json::Value>) -> Self {
        Self {
            value: Some(value.into()),
            conditions: Vec::new(),
            complete: true,
            refusal: None,
            partial: None,
            nullish: false,
        }
    }

    pub fn unknown() -> Self {
        Self {
            value: None,
            conditions: Vec::new(),
            complete: false,
            refusal: None,
            partial: None,
            nullish: false,
        }
    }

    /// JavaScript's `undefined`, known as such: no value, and nothing unknown or undecided.
    pub fn is_undefined(&self) -> bool {
        self.value.is_none() && self.complete && self.conditions.is_empty()
    }

    /// Truthiness, when it is decided. `undefined` decides as surely as a value: falsy.
    ///
    /// A value the build only guessed decides nothing: part of an object a spread it could not
    /// evaluate may have written over, `{ dense: false, ...props }`, or worked out from one. It
    /// used to decide on the guess, and the arm it chose was as complete as any, so the fold
    /// compiled `options.dense ? '2' : '4'` to `p_4` whatever the caller passed. An object or an
    /// array that surely is one is truthy however much of it is known.
    pub fn truthiness(&self) -> Option<bool> {
        match &self.value {
            Some(_) if self.surely_structured() => Some(true),
            Some(value) if self.decides() => Some(truthy(value)),
            Some(_) => None,
            None if self.is_undefined() => Some(false),
            None => None,
        }
    }

    /// Whether the value is what the program will have, so a choice may be made on it: complete,
    /// with no other value it may be instead. A value read off an array carries its siblings'
    /// choices for their rules (`converts`), and decides all the same.
    fn decides(&self) -> bool {
        self.complete && (self.conditions.is_empty() || self.converts())
    }

    /// Whether the value surely is the object or array it holds, however much of what it holds is
    /// known: whole, or with a record of what is not. Read where a spread may have written over it,
    /// it is a guess even of that — `{ icon: {}, ...props }` may hold `null` there — and has no
    /// record, as `Partial::open` drops what the object said of each key.
    fn surely_structured(&self) -> bool {
        matches!(
            self.value,
            Some(serde_json::Value::Object(_) | serde_json::Value::Array(_))
        ) && (self.complete || self.partial.is_some())
    }

    fn refused(refusal: Refusal) -> Self {
        Self {
            refusal: Some(Arc::new(refusal)),
            ..Self::unknown()
        }
    }

    /// Whether a `null` that may be `undefined` is the value or held anywhere inside it. A value
    /// replacing source has to be one or the other: a recipe takes a `null` variant for an
    /// explicit miss and `undefined` for its default, and a pattern's defaults stand in for
    /// `undefined` alone.
    pub fn holds_nullish(&self) -> bool {
        self.nullish || self.partial.as_deref().is_some_and(Partial::holds_nullish)
    }

    /// Whether the evaluator can tell the two apart: what is known of each, and what is not. Why
    /// a value is unknown changes nothing that reads it.
    fn same_as(&self, other: &Self) -> bool {
        self.complete == other.complete
            && self.value == other.value
            && self.conditions == other.conditions
            && self.partial == other.partial
            && self.nullish == other.nullish
    }

    /// A helper's arguments from a spread of unknown length on (`positional`): none is where it is
    /// placed, so no parameter from here on is known. Held as what no value is — `nullish`, with
    /// no value and not complete — and read only by `bind_parameters`.
    fn unplaced(refusal: Option<Arc<Refusal>>) -> Self {
        Self {
            refusal,
            nullish: true,
            ..Self::unknown()
        }
    }

    fn is_unplaced(&self) -> bool {
        self.nullish
            && self.value.is_none()
            && !self.complete
            && self.conditions.is_empty()
            && self.partial.is_none()
    }

    /// Whether converting the value — to a string, a number, a key — reads only what the build
    /// knows of it: complete, with no part of it not known. A complete array may still hold an
    /// element it could not decide between, which its record says; what a value read off an array
    /// carries of its siblings' choices, the array's `conditions`, is not the value, and an object
    /// converts to `[object Object]` whatever it holds.
    fn converts(&self) -> bool {
        self.complete && self.partial.as_deref().is_none_or(Partial::read_whole)
    }

    /// Whether it holds a value the build could not decide between: it is one of several, with none
    /// of its own, or an object with such a property, held beside it as a `{ key: value }` fragment
    /// (`conditions`). Anything else with `conditions` was read off an array and carries its
    /// siblings' choices as they are, for their rules — an object too, whose read keeps no
    /// fragment of theirs — and is one value all the same, where it is whole (`converts`).
    fn is_undecided(&self) -> bool {
        !self.conditions.is_empty()
            && match &self.value {
                Some(serde_json::Value::Object(_)) => {
                    !self.converts() || self.conditions.iter().any(serde_json::Value::is_object)
                }
                Some(_) => !self.converts(),
                None => true,
            }
    }

    fn undefined() -> Self {
        // JavaScript `undefined` is a known value, but has no JSON representation. It is
        // deliberately omitted from an object or argument just like the TypeScript extractor.
        Self {
            value: None,
            conditions: Vec::new(),
            complete: true,
            refusal: None,
            partial: None,
            nullish: false,
        }
    }

    pub fn data(self) -> Vec<serde_json::Value> {
        let mut output = self.conditions;
        if let Some(value) = self.value {
            output.push(value);
        }
        output
    }
}

#[derive(Clone, Debug)]
struct ImportBinding {
    specifier: String,
    imported: ImportedName,
}

#[derive(Clone, Debug)]
enum ImportedName {
    Named(String),
    Default,
    Namespace,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct ExportKey {
    file: String,
    name: String,
}

pub(crate) struct ProjectReads {
    pub dependencies: Vec<String>,
    pub pending_candidates: Vec<String>,
    pub configuration_files: Vec<String>,
}

/// How a recorded path was read, so a cache hit can replay it into the right ledger.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum ReadKind {
    Dependency,
    Pending,
    Configuration,
    /// Parsed for its text; recorded for validation only.
    Source,
}

/// One exported value, with every file its evaluation looked at and what each held then.
#[derive(Clone)]
struct CachedExport {
    result: EvalResult,
    reads: Vec<(ReadKind, String)>,
    /// Path → content hash, `None` for a path that did not exist.
    witnesses: Vec<(String, Option<u64>)>,
    /// How much of the call budget its evaluation spent.
    budget: CallBudget,
}

/// Helper calls an evaluation made: how deeply they nested, past where it started, and how many
/// there were. What `FileEvaluator::enter_call` limits, so what a cached value has to fit in to
/// be what evaluating it there would have given.
#[derive(Clone, Copy, Default)]
struct CallBudget {
    depth: u32,
    calls: u32,
}

/// Exported values, across native calls.
///
/// A Vite transform is one `compileModules` call, and each builds a fresh `ProjectEvaluator` —
/// so without this, a module importing three names from a fifty-module barrel re-parsed the
/// barrel's members on every transform, and every re-transform an edit caused. An entry is
/// used only when every file its evaluation read — source text, manifests, candidates that did
/// not exist — still hashes the same, so an edit anywhere on its route invalidates it.
/// Project fingerprint, file, exported name.
type ExportCacheKey = (u64, String, String);

static EXPORT_CACHE: OnceLock<Mutex<HashMap<ExportCacheKey, CachedExport>>> = OnceLock::new();
const EXPORT_CACHE_LIMIT: usize = 50_000;

/// A file's content hash by path, valid while its modification time and size stand still.
type FileStamp = (Option<std::time::SystemTime>, u64);
static FILE_HASHES: OnceLock<Mutex<HashMap<String, (FileStamp, u64)>>> = OnceLock::new();

fn content_hash(text: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut hasher);
    hasher.finish()
}

/// An outermost helper call given up on, past the depth or the count — see
/// `FileEvaluator::enter_call`.
struct Abandoned {
    refusal: EvalResult,
    /// Whether the refusal names the recursion yet. It is raised by whichever call went past the
    /// limit, which may be a helper the recursion calls in another module, where none of the
    /// recursion's own calls are to be seen; the first module returned to that has them names it.
    named: bool,
}

/// What a call re-entering an export finds of the call running it — see `call_export`.
enum Site {
    /// Being evaluated, or called and its function not found yet.
    Pending,
    /// Called, at its function: the refusal a call re-entering it gives, and whether one has.
    At {
        refusal: Arc<Refusal>,
        reentered: bool,
    },
    /// Re-exported, `export { a } from './a'` or `export *`: the export it forwards to answers.
    Forward(ExportKey),
}

/// The refusal a call re-entering the export at `key` gives, its function's, followed through the
/// re-exports that forward to it — a barrel the helpers are imported through. The site is marked
/// re-entered, so the call running it gives nothing either.
fn reenter(stack: &mut HashMap<ExportKey, Site>, key: &ExportKey) -> Option<Arc<Refusal>> {
    let mut key = key.clone();
    for _ in 0..=stack.len() {
        match stack.get_mut(&key)? {
            Site::Pending => return None,
            Site::At { refusal, reentered } => {
                *reentered = true;
                return Some(refusal.clone());
            }
            Site::Forward(target) => key = target.clone(),
        }
    }
    None
}

/// One `evaluate_export` frame's reads, and whether it was cut short — see `cut_short`.
#[derive(Default)]
struct ExportFrame {
    reads: HashSet<(ReadKind, String)>,
    cycle: bool,
    /// The call depth it started at, and the helper calls made since, nested ones included.
    start_depth: u32,
    deepest: u32,
    calls: u32,
}

impl ExportFrame {
    fn starting_at(depth: u32) -> Self {
        Self {
            start_depth: depth,
            deepest: depth,
            ..Self::default()
        }
    }

    fn budget(&self) -> CallBudget {
        CallBudget {
            depth: self.deepest - self.start_depth,
            calls: self.calls,
        }
    }

    /// Count in calls made `at` a depth, by a nested evaluation or a cached one.
    fn spend(&mut self, at: u32, budget: CallBudget) {
        self.deepest = self.deepest.max(at + budget.depth);
        self.calls += budget.calls;
    }
}

pub(crate) struct ProjectEvaluator<'a> {
    sources: HashMap<String, &'a str>,
    source_types: HashMap<String, SourceType>,
    entrypoints: &'a [NativeEntrypoint],
    cwd: PathBuf,
    base_url: Option<PathBuf>,
    paths: Vec<(String, Vec<String>)>,
    tokens: HashMap<String, (Option<serde_json::Value>, Option<String>)>,
    /// Exports being evaluated or called right now, and for a called one what a call re-entering
    /// it from another module finds — see `Site` and `call_export`.
    export_stack: RefCell<HashMap<ExportKey, Site>>,
    active_owner: RefCell<Option<String>>,
    dependencies: RefCell<HashMap<String, HashSet<String>>>,
    pending_candidates: RefCell<HashMap<String, HashSet<String>>>,
    configuration_files: RefCell<HashMap<String, HashSet<String>>>,
    /// Options an exported value depends on besides the files it read. Computed on first use:
    /// hashing the token table costs more than a module with no imports takes to analyze.
    fingerprint: std::cell::OnceCell<u64>,
    frames: RefCell<Vec<ExportFrame>>,
    /// Helper calls being evaluated right now, nested — across files, since a helper may call
    /// one in another module — and how many the outermost of them has made. See
    /// `FileEvaluator::enter_call`.
    call_depth: Cell<u32>,
    call_count: Cell<u32>,
    /// Set when a call past the depth or the count is refused: what every call returns until the
    /// outermost one has.
    abandoned: RefCell<Option<Abandoned>>,
}

impl<'a> ProjectEvaluator<'a> {
    pub fn new(
        sources: impl IntoIterator<Item = (&'a str, &'a str)>,
        entrypoints: &'a [NativeEntrypoint],
        options: Option<&NativeProjectOptions>,
    ) -> Self {
        let mut source_map = HashMap::new();
        let mut source_types = HashMap::new();
        for (filename, source) in sources {
            let normalized = normalize_path(filename);
            source_types.insert(normalized.clone(), source_type_for(filename));
            source_map.insert(normalized, source);
        }
        let cwd = options
            .and_then(|options| options.cwd.as_deref())
            .map(PathBuf::from)
            .or_else(|| std::env::current_dir().ok())
            .unwrap_or_default();
        let base_url = options
            .and_then(|options| options.base_url.as_deref())
            .map(|base| cwd.join(base));
        let paths: Vec<(String, Vec<String>)> = options
            .map(|options| {
                options
                    .paths
                    .iter()
                    .map(|mapping| (mapping.pattern.clone(), mapping.paths.clone()))
                    .collect()
            })
            .unwrap_or_default();
        let tokens: HashMap<String, (Option<serde_json::Value>, Option<String>)> = options
            .map(|options| {
                options
                    .tokens
                    .iter()
                    .map(|token| {
                        (
                            token.path.clone(),
                            (token.value.clone(), token.variable.clone()),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();
        Self {
            fingerprint: std::cell::OnceCell::new(),
            frames: RefCell::new(Vec::new()),
            call_depth: Cell::new(0),
            call_count: Cell::new(0),
            abandoned: RefCell::new(None),
            sources: source_map,
            source_types,
            entrypoints,
            cwd,
            base_url,
            paths,
            tokens,
            export_stack: RefCell::new(HashMap::new()),
            active_owner: RefCell::new(None),
            dependencies: RefCell::new(HashMap::new()),
            pending_candidates: RefCell::new(HashMap::new()),
            configuration_files: RefCell::new(HashMap::new()),
        }
    }

    pub fn begin_file(&self, filename: &str) {
        *self.active_owner.borrow_mut() = Some(normalize_path(filename));
    }

    pub fn end_file(&self, filename: &str) -> ProjectReads {
        *self.active_owner.borrow_mut() = None;
        let owner = normalize_path(filename);
        let take = |map: &RefCell<HashMap<String, HashSet<String>>>| {
            let mut values = map
                .borrow_mut()
                .remove(&owner)
                .unwrap_or_default()
                .into_iter()
                .collect::<Vec<_>>();
            values.sort();
            values
        };
        ProjectReads {
            dependencies: take(&self.dependencies),
            pending_candidates: take(&self.pending_candidates),
            configuration_files: take(&self.configuration_files),
        }
    }

    /// Resolve a specifier from an importer, recording the read against the active owner.
    pub fn resolve_specifier(&self, importer: &str, specifier: &str) -> Option<String> {
        self.resolve(importer, specifier)
    }

    /// Run `work` with its reads recorded apart from the active owner's, and return them.
    ///
    /// For a walk that has to look at many modules to find the few that matter: the caller
    /// decides which of the returned reads to keep, instead of every probe becoming an edge.
    pub fn capture<T>(&self, work: impl FnOnce() -> T) -> (T, Vec<String>) {
        thread_local! {
            static NEXT: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
        }
        let sentinel = NEXT.with(|next| {
            let id = next.get();
            next.set(id + 1);
            format!("\0capture#{id}")
        });
        let previous = self.active_owner.replace(Some(sentinel.clone()));
        let value = work();
        *self.active_owner.borrow_mut() = previous;
        let mut reads = self
            .dependencies
            .borrow_mut()
            .remove(&sentinel)
            .unwrap_or_default()
            .into_iter()
            .collect::<Vec<_>>();
        self.pending_candidates.borrow_mut().remove(&sentinel);
        self.configuration_files.borrow_mut().remove(&sentinel);
        reads.sort();
        (value, reads)
    }

    /// Run `work` with every file it reads — source text, resolution probes, manifests —
    /// collected, and return them with what each held, for a caller caching the result.
    pub fn witnessed<T>(&self, work: impl FnOnce() -> T) -> (T, Vec<(String, Option<u64>)>) {
        self.frames.borrow_mut().push(ExportFrame::default());
        let value = work();
        let frame = self.frames.borrow_mut().pop().unwrap_or_default();
        if let Some(parent) = self.frames.borrow_mut().last_mut() {
            parent.reads.extend(frame.reads.iter().cloned());
        }
        let mut paths: Vec<String> = frame.reads.into_iter().map(|(_, path)| path).collect();
        paths.sort();
        paths.dedup();
        let witnesses = paths
            .into_iter()
            .map(|path| {
                let hash = self.witness(&path);
                (path, hash)
            })
            .collect();
        (value, witnesses)
    }

    /// Whether every witnessed file still holds what it held.
    pub fn witnesses_hold(&self, witnesses: &[(String, Option<u64>)]) -> bool {
        witnesses
            .iter()
            .all(|(path, hash)| self.witness(path) == *hash)
    }

    /// Options an evaluation depends on besides the files it read.
    pub fn fingerprint(&self) -> u64 {
        *self.fingerprint.get_or_init(|| {
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            self.cwd.hash(&mut hasher);
            self.base_url.hash(&mut hasher);
            self.paths.hash(&mut hasher);
            let mut token_keys: Vec<_> = self
                .tokens
                .iter()
                .map(|(path, (value, variable))| {
                    (
                        path.clone(),
                        value.as_ref().map(ToString::to_string),
                        variable.clone(),
                    )
                })
                .collect();
            token_keys.sort();
            token_keys.hash(&mut hasher);
            for entrypoint in self.entrypoints {
                entrypoint.kind.hash(&mut hasher);
                entrypoint.modules.hash(&mut hasher);
                entrypoint.names.hash(&mut hasher);
            }
            hasher.finish()
        })
    }

    /// The text of a module as the project holds it (a supplied source, or disk).
    pub fn module_text(&self, filename: &str) -> Option<String> {
        self.source(filename)
            .map(|source| source.as_str().to_string())
    }

    pub fn entrypoint(&self, specifier: &str) -> Option<&NativeEntrypoint> {
        self.entrypoints.iter().find(|entrypoint| {
            entrypoint
                .modules
                .iter()
                .any(|module| specifier.contains(module))
        })
    }

    fn token(&self, path: &str, value: bool) -> Option<serde_json::Value> {
        let (literal, variable) = self.tokens.get(path)?;
        if value {
            literal.clone()
        } else {
            variable.clone().map(Into::into)
        }
    }

    fn source(&self, filename: &str) -> Option<StringSource<'a>> {
        let normalized = normalize_path(filename);
        self.note_read(ReadKind::Source, &normalized);
        self.source_unrecorded(&normalized)
    }

    fn source_unrecorded(&self, normalized: &str) -> Option<StringSource<'a>> {
        if let Some(source) = self.sources.get(normalized) {
            return Some(StringSource::Borrowed(source));
        }
        fs::read_to_string(normalized).ok().map(StringSource::Owned)
    }

    /// Add a read to every open export frame, so each can be cached with what it depends on.
    fn note_read(&self, kind: ReadKind, path: &str) {
        let mut frames = self.frames.borrow_mut();
        if let Some(frame) = frames.last_mut() {
            frame.reads.insert((kind, path.to_string()));
        }
    }

    fn record_read(&self, map: &RefCell<HashMap<String, HashSet<String>>>, path: &Path) {
        let normalized = normalize_path(path.to_string_lossy().as_ref());
        let kind = if std::ptr::eq(map, &self.dependencies) {
            ReadKind::Dependency
        } else if std::ptr::eq(map, &self.pending_candidates) {
            ReadKind::Pending
        } else {
            ReadKind::Configuration
        };
        self.note_read(kind, &normalized);
        self.record_normalized(map, normalized);
    }

    fn record_normalized(
        &self,
        map: &RefCell<HashMap<String, HashSet<String>>>,
        normalized: String,
    ) {
        if let Some(owner) = self.active_owner.borrow().as_ref() {
            map.borrow_mut()
                .entry(owner.clone())
                .or_default()
                .insert(normalized);
        }
    }

    /// The content hash of a path as this project reads it, `None` when it does not exist.
    ///
    /// A file on disk is re-read only when its modification time or size moved: validating a
    /// cached barrel lookup checks every member, and hashing each one's text on every transform
    /// cost a noticeable share of what the cache saved.
    fn witness(&self, path: &str) -> Option<u64> {
        if let Some(source) = self.sources.get(path) {
            return Some(content_hash(source));
        }
        let metadata = fs::metadata(path).ok()?;
        if !metadata.is_file() {
            return fs::read_to_string(path)
                .ok()
                .map(|text| content_hash(&text));
        }
        let stamp = (metadata.modified().ok(), metadata.len());
        let memo = FILE_HASHES.get_or_init(|| Mutex::new(HashMap::new()));
        if let Some((known, hash)) = memo.lock().ok().and_then(|memo| memo.get(path).cloned())
            && known == stamp
        {
            return Some(hash);
        }
        let hash = content_hash(&fs::read_to_string(path).ok()?);
        if let Ok(mut memo) = memo.lock() {
            if memo.len() >= EXPORT_CACHE_LIMIT {
                memo.clear();
            }
            memo.insert(path.to_string(), (stamp, hash));
        }
        Some(hash)
    }

    /// Replay a cached entry's reads as if the evaluation had just made them.
    fn replay(&self, reads: &[(ReadKind, String)]) {
        for (kind, path) in reads {
            self.note_read(*kind, path);
            match kind {
                ReadKind::Dependency => self.record_normalized(&self.dependencies, path.clone()),
                ReadKind::Pending => self.record_normalized(&self.pending_candidates, path.clone()),
                ReadKind::Configuration => {
                    self.record_normalized(&self.configuration_files, path.clone())
                }
                ReadKind::Source => {}
            }
        }
    }

    fn package_import_bases(&self, importer: &Path, specifier: &str) -> Vec<PathBuf> {
        let mut directory = importer.parent();
        while let Some(current) = directory {
            let manifest = current.join("package.json");
            if manifest.is_file() {
                // The nearest package scope owns every `#` specifier. Record it even when the
                // current map has no matching key, because adding one must invalidate an
                // unchanged importer on the next incremental pass.
                self.record_read(&self.configuration_files, &manifest);
                let Ok(source) = fs::read_to_string(&manifest) else {
                    return Vec::new();
                };
                let Ok(json) = serde_json::from_str::<serde_json::Value>(&source) else {
                    return Vec::new();
                };
                let Some(imports) = json.get("imports").and_then(serde_json::Value::as_object)
                else {
                    return Vec::new();
                };
                let Some((mapping, capture)) = package_mapping(imports, specifier) else {
                    return Vec::new();
                };
                let mut targets = Vec::new();
                collect_package_targets(mapping, &mut targets);
                return targets
                    .into_iter()
                    .map(|target| current.join(target.replace('*', capture)))
                    .collect();
            }
            directory = current.parent();
        }
        Vec::new()
    }

    fn package_bases(&self, importer: &Path, specifier: &str) -> Vec<PathBuf> {
        let segments = specifier.split('/').collect::<Vec<_>>();
        let package_segments = if specifier.starts_with('@') { 2 } else { 1 };
        if segments.len() < package_segments {
            return Vec::new();
        }
        let package_name = segments[..package_segments].join("/");
        let subpath = segments[package_segments..].join("/");
        let mut directory = importer.parent();
        while let Some(current) = directory {
            let package = current.join("node_modules").join(&package_name);
            let manifest = package.join("package.json");
            if manifest.is_file()
                && let Ok(source) = fs::read_to_string(&manifest)
                && let Ok(json) = serde_json::from_str::<serde_json::Value>(&source)
            {
                self.record_read(&self.configuration_files, &manifest);
                let mut targets = Vec::new();
                let has_exports = json.get("exports").is_some();
                if let Some(exports) = json.get("exports") {
                    let key = if subpath.is_empty() {
                        ".".to_string()
                    } else {
                        format!("./{subpath}")
                    };
                    let mapping = if let Some(exports) = exports.as_object()
                        && exports.keys().any(|key| key.starts_with('.'))
                    {
                        package_mapping(exports, &key)
                    } else if subpath.is_empty() {
                        Some((exports, ""))
                    } else {
                        None
                    };
                    if let Some((export, capture)) = mapping {
                        collect_package_targets(export, &mut targets);
                        for target in &mut targets {
                            *target = target.replace('*', capture);
                        }
                    }
                }
                if targets.is_empty() {
                    if has_exports {
                        return Vec::new();
                    }
                    if !subpath.is_empty() {
                        targets.push(subpath);
                    } else {
                        for field in ["source", "module", "main"] {
                            if let Some(value) = json.get(field).and_then(serde_json::Value::as_str)
                            {
                                targets.push(value.to_string());
                                break;
                            }
                        }
                        if targets.is_empty() {
                            targets.push("index".to_string());
                        }
                    }
                }
                return targets
                    .into_iter()
                    .map(|target| package.join(target))
                    .collect();
            }
            directory = current.parent();
        }
        Vec::new()
    }

    fn resolve(&self, importer: &str, specifier: &str) -> Option<String> {
        let mut bases = Vec::new();
        let importer_path = Path::new(importer);
        if specifier.starts_with('.') {
            bases.push(importer_path.parent()?.join(specifier));
        } else if Path::new(specifier).is_absolute() {
            bases.push(PathBuf::from(specifier));
        } else {
            let path_mapping = self
                .paths
                .iter()
                .filter_map(|(pattern, targets)| {
                    wildcard_match(pattern, specifier).map(|capture| (pattern, targets, capture))
                })
                .max_by_key(|(pattern, _, _)| path_mapping_priority(pattern));
            let matched_path = path_mapping.is_some();
            if let Some((_, targets, capture)) = path_mapping {
                for target in targets {
                    let target = target.replace('*', capture);
                    bases.push(self.base_url.as_ref().unwrap_or(&self.cwd).join(target));
                }
            }
            if specifier.starts_with('#') {
                if !matched_path {
                    bases.extend(self.package_import_bases(importer_path, specifier));
                }
            } else {
                if let Some(base_url) = &self.base_url {
                    bases.push(base_url.join(specifier));
                }
                bases.extend(self.package_bases(importer_path, specifier));
            }
        }

        for base in bases {
            let mut higher_priority: Vec<PathBuf> = Vec::new();
            for candidate in path_candidates(&base) {
                let normalized = normalize_path(candidate.to_string_lossy().as_ref());
                if self.sources.contains_key(&normalized) || candidate.is_file() {
                    for pending in higher_priority {
                        self.record_read(&self.pending_candidates, &pending);
                    }
                    self.record_read(&self.dependencies, &candidate);
                    return Some(normalized);
                }
                // The extensionless lexical base is not a file TypeScript redirects to when
                // it appears, but an earlier source extension is. Keep only those real
                // higher-priority candidates (for example target.ts before target.tsx).
                if candidate != base && candidate.extension().is_some() {
                    higher_priority.push(candidate);
                }
            }
            // No candidate exists yet. Any source spelling in the resolver's precedence
            // table can make this import start resolving, not only the lexical specifier
            // (`./value.js` may appear as `value.ts`, for example).
            for candidate in path_candidates(&base) {
                if candidate != base || candidate.extension().is_some() {
                    self.record_read(&self.pending_candidates, &candidate);
                }
            }
        }
        None
    }

    fn evaluate_import(&self, importer: &str, binding: &ImportBinding) -> EvalResult {
        let ImportedName::Named(name) = &binding.imported else {
            // Preserve the established boundary. Default and namespace values were never
            // executed across files, because doing so would turn package/application modules
            // into build scripts.
            return EvalResult::unknown();
        };
        let Some(target) = self.resolve(importer, &binding.specifier) else {
            return EvalResult::unknown();
        };
        self.evaluate_export(&target, name)
    }

    /// Keep every export being evaluated out of the cache: one was cut short, by a cycle or a
    /// refused call, in a way that depends on where the evaluation started, and the same export
    /// asked for from elsewhere would not be.
    fn cut_short(&self) {
        for frame in self.frames.borrow_mut().iter_mut() {
            frame.cycle = true;
        }
    }

    /// As `cut_short`, for a limit on helper calls: it counts from the outermost call, so an export
    /// evaluated outside any — a module's own initializer — is refused the same wherever it is
    /// asked for from, and is kept, to be replayed only where its calls fit (`fits`). One asked for
    /// from inside a call is not: how deep it went, and how many calls it made, are that call's.
    fn cut_short_within_calls(&self) {
        for frame in self.frames.borrow_mut().iter_mut() {
            if frame.start_depth > 0 {
                frame.cycle = true;
            }
        }
    }

    /// Count a helper call in, one deeper than `depth`, against the call limits and the export
    /// being evaluated.
    fn count_call(&self, depth: u32) {
        self.call_depth.set(depth + 1);
        self.call_count.set(self.call_count.get() + 1);
        if let Some(frame) = self.frames.borrow_mut().last_mut() {
            frame.spend(depth, CallBudget { depth: 1, calls: 1 });
        }
    }

    /// Whether an evaluation that spent `budget` would spend it here with no call refused, so a
    /// cached result of it is what evaluating it here would give. Inside a helper call, its calls
    /// count toward the outermost one's; at the top, each call it makes there starts its own count.
    fn fits(&self, budget: CallBudget) -> bool {
        let depth = self.call_depth.get();
        depth + budget.depth <= MAX_CALL_DEPTH
            && (depth == 0 || self.call_count.get() + budget.calls <= MAX_CALLS)
    }

    /// Count in a cached evaluation's calls as if they had been made here.
    fn spend(&self, budget: CallBudget) {
        let depth = self.call_depth.get();
        if depth > 0 {
            self.call_count.set(self.call_count.get() + budget.calls);
        }
        if let Some(frame) = self.frames.borrow_mut().last_mut() {
            frame.spend(depth, budget);
        }
    }

    fn evaluate_export(&self, filename: &str, name: &str) -> EvalResult {
        let key = ExportKey {
            file: normalize_path(filename),
            name: name.to_string(),
        };
        {
            let mut stack = self.export_stack.borrow_mut();
            if stack.contains_key(&key) {
                drop(stack);
                self.cut_short();
                return EvalResult::unknown();
            }
            stack.insert(key.clone(), Site::Pending);
        }
        let cache_key = (self.fingerprint(), key.file.clone(), key.name.clone());
        let cached = EXPORT_CACHE
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .ok()
            .and_then(|cache| cache.get(&cache_key).cloned());
        // Asked for deeper in, or further into the count, than it was evaluated, the same export
        // could have been refused: then it is evaluated here instead, and refused here.
        if let Some(entry) = cached
            && self.fits(entry.budget)
            && entry
                .witnesses
                .iter()
                .all(|(path, hash)| self.witness(path) == *hash)
        {
            self.replay(&entry.reads);
            self.spend(entry.budget);
            self.export_stack.borrow_mut().remove(&key);
            return entry.result;
        }

        let depth = self.call_depth.get();
        self.frames
            .borrow_mut()
            .push(ExportFrame::starting_at(depth));
        let result = self.evaluate_export_uncached(&key.file, &key.name);
        let frame = self.frames.borrow_mut().pop().unwrap_or_default();
        let budget = frame.budget();
        self.export_stack.borrow_mut().remove(&key);

        // Everything this frame read, the enclosing frame read too; every call it made, too.
        if let Some(parent) = self.frames.borrow_mut().last_mut() {
            parent.reads.extend(frame.reads.iter().cloned());
            parent.spend(depth, budget);
        }
        if !frame.cycle {
            let mut reads: Vec<_> = frame.reads.into_iter().collect();
            reads.sort_by(|a, b| a.1.cmp(&b.1).then((a.0 as u8).cmp(&(b.0 as u8))));
            let mut paths: Vec<&String> = reads.iter().map(|(_, path)| path).collect();
            paths.sort();
            paths.dedup();
            let witnesses = paths
                .into_iter()
                .map(|path| (path.clone(), self.witness(path)))
                .collect();
            if let Ok(mut cache) = EXPORT_CACHE
                .get_or_init(|| Mutex::new(HashMap::new()))
                .lock()
            {
                if cache.len() >= EXPORT_CACHE_LIMIT {
                    cache.clear();
                }
                cache.insert(
                    cache_key,
                    CachedExport {
                        result: result.clone(),
                        reads,
                        witnesses,
                        budget,
                    },
                );
            }
        }
        result
    }

    fn evaluate_export_uncached(&self, filename: &str, name: &str) -> EvalResult {
        let Some(source) = self.source(filename) else {
            return EvalResult::unknown();
        };
        let source_type = self
            .source_types
            .get(filename)
            .copied()
            .unwrap_or_else(|| source_type_for(filename));
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source.as_str(), source_type).parse();
        if !parsed.diagnostics.is_empty() {
            return EvalResult::unknown();
        }
        let semantic = SemanticBuilder::new_compiler()
            .with_build_nodes(true)
            .build(&parsed.program);
        if !semantic.diagnostics.is_empty() {
            return EvalResult::unknown();
        }
        let mut evaluator = FileEvaluator::new(filename, self, &semantic.semantic, &parsed.program);

        // `export const value = …` and `export function helper() { … }`.
        for statement in &parsed.program.body {
            if let Statement::ExportDeclaration(export) = statement {
                match &export.declaration {
                    Declaration::VariableDeclaration(declaration) => {
                        for declarator in &declaration.declarations {
                            if declarator
                                .id
                                .get_binding_identifier()
                                .is_some_and(|id| id.name == name)
                                && let Some(symbol) = declarator
                                    .id
                                    .get_binding_identifier()
                                    .and_then(|id| id.symbol_id.get())
                            {
                                return evaluator.evaluate_symbol(symbol);
                            }
                        }
                    }
                    Declaration::FunctionDeclaration(function)
                        if function.id.as_ref().is_some_and(|id| id.name == name) =>
                    {
                        // A function is meaningful only when called. Returning unknown here
                        // keeps a bare function value out of style data.
                        return EvalResult::unknown();
                    }
                    // As one in the module itself is read: refused once anything writes to it, and
                    // not known declared twice (`evaluate_symbol`).
                    Declaration::TSEnumDeclaration(enumeration) if enumeration.id.name == name => {
                        return enumeration
                            .id
                            .symbol_id
                            .get()
                            .map_or_else(EvalResult::unknown, |symbol| {
                                evaluator.evaluate_symbol(symbol)
                            });
                    }
                    _ => {}
                }
            }
        }

        // `export { local as public }` and `export { value as public } from './module'`.
        for statement in &parsed.program.body {
            match statement {
                Statement::ExportNamedDeclaration(export) => {
                    for specifier in &export.specifiers {
                        if module_name(&specifier.exported) != name {
                            continue;
                        }
                        if let ModuleExportName::IdentifierReference(identifier) = &specifier.local
                            && let Some(reference) = identifier.reference_id.get()
                            && let Some(symbol) =
                                evaluator.scoping.get_reference(reference).symbol_id()
                        {
                            return evaluator.evaluate_symbol(symbol);
                        }
                    }
                }
                Statement::ExportFromDeclaration(export) => {
                    for specifier in &export.specifiers {
                        if module_name(&specifier.exported) != name {
                            continue;
                        }
                        let Some(target) = self.resolve(filename, export.source.value.as_str())
                        else {
                            return EvalResult::unknown();
                        };
                        return self.evaluate_export(&target, module_name(&specifier.local));
                    }
                }
                _ => {}
            }
        }

        // A star barrel. Cycles terminate through `export_stack`, while another exported name
        // may still continue through the same file because the key includes the name.
        for statement in &parsed.program.body {
            if let Statement::ExportAllDeclaration(export) = statement {
                let Some(target) = self.resolve(filename, export.source.value.as_str()) else {
                    continue;
                };
                let result = self.evaluate_export(&target, name);
                // Refused, it was found there: why is the answer, not the next member's silence.
                if result.value.is_some() || result.complete || result.refusal.is_some() {
                    return result;
                }
            }
        }
        EvalResult::unknown()
    }

    fn call_imported(
        &self,
        importer: &str,
        binding: &ImportBinding,
        arguments: Vec<EvalResult>,
    ) -> EvalResult {
        let ImportedName::Named(name) = &binding.imported else {
            return EvalResult::unknown();
        };
        let Some(target) = self.resolve(importer, &binding.specifier) else {
            return EvalResult::unknown();
        };
        self.call_export(&target, name, arguments)
    }

    /// Call the function another module exports as `name`.
    ///
    /// Not while it is already running: called again through another module, each call would
    /// parse the module afresh, and none would be the call running, so a recursion between
    /// modules could not be told from one that ends. The call is refused, at the function, and
    /// where that happens depends on where the evaluation started.
    fn call_export(&self, filename: &str, name: &str, arguments: Vec<EvalResult>) -> EvalResult {
        let key = ExportKey {
            file: normalize_path(filename),
            name: format!("{name}()"),
        };
        {
            let mut stack = self.export_stack.borrow_mut();
            if stack.contains_key(&key) {
                let refusal = reenter(&mut stack, &key);
                drop(stack);
                self.cut_short();
                return EvalResult {
                    refusal,
                    ..EvalResult::unknown()
                };
            }
            stack.insert(key.clone(), Site::Pending);
        }
        let result = self.call_export_uncached(filename, name, arguments, &key);
        // Re-entered while it ran, the recursion gives nothing, as one refused within a module
        // does (`FileEvaluator::enter_call`): what its levels had built is not what it returns.
        match self.export_stack.borrow_mut().remove(&key) {
            Some(Site::At {
                refusal,
                reentered: true,
            }) => EvalResult {
                refusal: Some(refusal),
                ..EvalResult::unknown()
            },
            _ => result,
        }
    }

    /// The export at `key` is re-exported from the one `target` exports as `name`, which answers
    /// for it if a call re-enters it.
    fn forward(&self, key: &ExportKey, target: &str, name: &str) {
        if let Some(site) = self.export_stack.borrow_mut().get_mut(key) {
            *site = Site::Forward(ExportKey {
                file: normalize_path(target),
                name: format!("{name}()"),
            });
        }
    }

    /// Where a call re-entering the export at `key` is refused: at `at`, its function, named
    /// `name` there — which an export written `export { a as styled }` is not named outside.
    fn call_site(
        &self,
        key: &ExportKey,
        evaluator: &FileEvaluator<'_, '_, 'a>,
        name: &str,
        at: oxc_span::Span,
    ) {
        let refusal = evaluator.refusal(
            "recursion",
            "module".to_string(),
            Some(name.to_string()),
            at,
            at,
        );
        if let Some(site) = self.export_stack.borrow_mut().get_mut(key) {
            *site = Site::At {
                refusal: Arc::new(refusal),
                reentered: false,
            };
        }
    }

    fn call_export_uncached(
        &self,
        filename: &str,
        name: &str,
        arguments: Vec<EvalResult>,
        key: &ExportKey,
    ) -> EvalResult {
        let Some(source) = self.source(filename) else {
            return EvalResult::unknown();
        };
        let source_type = self
            .source_types
            .get(filename)
            .copied()
            .unwrap_or_else(|| source_type_for(filename));
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source.as_str(), source_type).parse();
        if !parsed.diagnostics.is_empty() {
            return EvalResult::unknown();
        }
        let semantic = SemanticBuilder::new_compiler()
            .with_build_nodes(true)
            .build(&parsed.program);
        if !semantic.diagnostics.is_empty() {
            return EvalResult::unknown();
        }
        let mut evaluator = FileEvaluator::new(filename, self, &semantic.semantic, &parsed.program);

        for statement in &parsed.program.body {
            if let Statement::ExportDeclaration(export) = statement {
                match &export.declaration {
                    Declaration::FunctionDeclaration(function)
                        if function.id.as_ref().is_some_and(|id| id.name == name) =>
                    {
                        self.call_site(key, &evaluator, name, function.span);
                        return evaluator.with_helper(name, |evaluator| {
                            evaluator.call_function(function, arguments)
                        });
                    }
                    Declaration::VariableDeclaration(declaration) => {
                        for declarator in &declaration.declarations {
                            if declarator
                                .id
                                .get_binding_identifier()
                                .is_some_and(|id| id.name == name)
                                && let Some(expression) = &declarator.init
                            {
                                self.call_site(key, &evaluator, name, expression.span());
                                return evaluator.with_helper(name, |evaluator| {
                                    evaluator.call_expression_value(expression, arguments)
                                });
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        for statement in &parsed.program.body {
            match statement {
                Statement::ExportNamedDeclaration(export) => {
                    for specifier in &export.specifiers {
                        if module_name(&specifier.exported) != name {
                            continue;
                        }
                        if let ModuleExportName::IdentifierReference(identifier) = &specifier.local
                            && let Some(reference) = identifier.reference_id.get()
                            && let Some(symbol) =
                                evaluator.scoping.get_reference(reference).symbol_id()
                        {
                            // The function, as the other two spellings point at: not `a = …`.
                            let at = match evaluator.semantic.symbol_declaration(symbol).kind() {
                                AstKind::VariableDeclarator(declarator) => declarator
                                    .init
                                    .as_ref()
                                    .map_or(declarator.span, GetSpan::span),
                                declaration => declaration.span(),
                            };
                            self.call_site(key, &evaluator, identifier.name.as_str(), at);
                            return evaluator.call_symbol(symbol, arguments);
                        }
                    }
                }
                Statement::ExportFromDeclaration(export) => {
                    for specifier in &export.specifiers {
                        if module_name(&specifier.exported) != name {
                            continue;
                        }
                        let Some(target) = self.resolve(filename, export.source.value.as_str())
                        else {
                            return EvalResult::unknown();
                        };
                        let local = module_name(&specifier.local);
                        self.forward(key, &target, local);
                        return self.call_export(&target, local, arguments);
                    }
                }
                Statement::ExportAllDeclaration(export) => {
                    let Some(target) = self.resolve(filename, export.source.value.as_str()) else {
                        continue;
                    };
                    self.forward(key, &target, name);
                    let result = self.call_export(&target, name, arguments.clone());
                    // Refused, it was found there: why is the answer, not the next member's silence.
                    if result.value.is_some() || result.complete || result.refusal.is_some() {
                        return result;
                    }
                }
                _ => {}
            }
        }
        EvalResult::unknown()
    }
}

enum StringSource<'a> {
    Borrowed(&'a str),
    Owned(String),
}
impl StringSource<'_> {
    fn as_str(&self) -> &str {
        match self {
            Self::Borrowed(value) => value,
            Self::Owned(value) => value,
        }
    }
}

pub(crate) struct FileEvaluator<'a, 'project, 'sources> {
    filename: &'a str,
    project: &'project ProjectEvaluator<'sources>,
    semantic: &'a Semantic<'a>,
    pub scoping: &'a Scoping,
    imports: HashMap<SymbolId, ImportBinding>,
    environment: HashMap<SymbolId, EvalResult>,
    evaluating: HashSet<SymbolId>,
    /// `mutation`, once per symbol: the answer scans every reference to it.
    mutations: HashMap<SymbolId, Option<NodeId>>,
    /// The helper whose body is running, for a refusal inside it to name. Borrowed from the
    /// symbol table wherever it can be, since only a refusal ever reads it.
    helper: Option<Cow<'a, str>>,
    /// The name `with_helper` gave the call about to run, which takes it — so a function written
    /// in place and called there is not given the name of the helper it is written in.
    callee: Option<Cow<'a, str>>,
    /// Helper calls running in this file, outermost first.
    calls: Vec<ActiveCall<'a>>,
}

/// A helper call that is running, as `FileEvaluator::enter_call` compares the next one against.
struct ActiveCall<'a> {
    /// The function's node, by address. Every call that is running holds its tree alive, so no
    /// two of them can be at one address.
    function: usize,
    /// Where the function is, and its name when it has one, for a refusal to point at.
    at: oxc_span::Span,
    name: Option<Cow<'a, str>>,
    /// What it was given, as the next call of the same function is compared with it — see `Given`.
    arguments: Vec<Given>,
    /// `fingerprint` of the arguments, once a call of the same function is compared with them.
    fingerprint: std::cell::OnceCell<u64>,
    /// As it was before the call bound its parameters: what the body reads besides them, and
    /// what is restored when it returns.
    environment: HashMap<SymbolId, EvalResult>,
    /// What the call returns instead, once a recursion through it is refused.
    refused: Option<EvalResult>,
}

/// An argument a running call was given. One bound as it is to a parameter — a name with no
/// default, before any spread of unknown length — is read back from where it is bound, so a theme
/// passed down is not copied beside each call it passes through; any other is held.
enum Given {
    Bound(SymbolId),
    Held(EvalResult),
}

impl Given {
    /// The argument, read back from `bound`, the environment its call's parameters are bound in,
    /// where it is bound there.
    fn read<'c>(&'c self, bound: &'c HashMap<SymbolId, EvalResult>) -> Option<&'c EvalResult> {
        match self {
            Self::Bound(symbol) => bound.get(symbol),
            Self::Held(value) => Some(value),
        }
    }
}

/// What tells arguments apart without walking them all the way down: each one, and what an array
/// or an object holds one level in, read as `shallow` does.
///
/// Arguments the evaluator cannot tell apart have the same fingerprint, so two calls are compared
/// in depth only when it cannot tell them apart either. A recursion passing a theme down unchanged
/// passes something that changes beside it — a number, or a field of an object built for the
/// next level, `{ depth: d - 1, theme }` — and comparing the theme at every level, against every
/// call running, would be quadratic in the depth.
fn fingerprint<'r>(arguments: impl IntoIterator<Item = &'r EvalResult>) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for argument in arguments {
        (
            argument.complete,
            argument.conditions.len(),
            argument.partial.is_some(),
            argument.nullish,
        )
            .hash(&mut hasher);
        let Some(value) = &argument.value else {
            0_u8.hash(&mut hasher);
            continue;
        };
        shallow(value, &mut hasher);
        match value {
            serde_json::Value::Array(items) => {
                for item in items {
                    shallow(item, &mut hasher);
                }
            }
            // Equal objects can hold their keys in different orders, so the entries are summed.
            serde_json::Value::Object(entries) => {
                let entries = entries.iter().fold(0_u64, |sum, (key, value)| {
                    let mut entry = std::collections::hash_map::DefaultHasher::new();
                    key.hash(&mut entry);
                    shallow(value, &mut entry);
                    sum.wrapping_add(entry.finish())
                });
                entries.hash(&mut hasher);
            }
            _ => {}
        }
    }
    hasher.finish()
}

/// A value's kind, with a scalar's value, a string's text, or an array's or object's length.
fn shallow(value: &serde_json::Value, hasher: &mut impl Hasher) {
    match value {
        serde_json::Value::Null => 1_u8.hash(hasher),
        serde_json::Value::Bool(value) => (2_u8, value).hash(hasher),
        // `0.0` and `-0.0` are one value, and two bit patterns.
        serde_json::Value::Number(value) => {
            let number = value.as_f64().filter(|number| *number != 0.0);
            (3_u8, number.map(f64::to_bits)).hash(hasher);
        }
        serde_json::Value::String(value) => (4_u8, value).hash(hasher),
        serde_json::Value::Array(value) => (5_u8, value.len()).hash(hasher),
        serde_json::Value::Object(value) => (6_u8, value.len()).hash(hasher),
    }
}

fn same_environment(
    running: &HashMap<SymbolId, EvalResult>,
    next: &HashMap<SymbolId, EvalResult>,
) -> bool {
    running.len() == next.len()
        && running
            .iter()
            .all(|(symbol, value)| next.get(symbol).is_some_and(|other| value.same_as(other)))
}

/// The call a recursion is named for, an index into `calls`: the outermost call of the helper that
/// recurs, given that `entered`, the function of a call inside them all, is being called or has
/// returned.
///
/// Repeating its arguments (`looped`), the recursion is the cycle `entered` closes, every helper
/// running from its outermost call of `entered` in: `walk(2)` calling `nest(p)`, which calls itself
/// on what it was given, is `nest`'s, though `walk` recursed to reach it, and `a` calling `b`
/// calling `a` is `a`'s, whichever of the two was found repeating. Past
/// a limit it is the helper recursing innermost, a named one before one written in place — an
/// arrow passed to `.map` runs once a level as surely as the helper calling it.
fn recursion_at(calls: &[ActiveCall<'_>], entered: usize, looped: bool) -> Option<usize> {
    if looped {
        let start = calls.iter().position(|call| call.function == entered)?;
        let cycle = |function: usize| {
            function == entered || calls[start..].iter().any(|call| call.function == function)
        };
        return calls.iter().position(|call| cycle(call.function));
    }
    let recurs = |function: usize| {
        function == entered
            || calls
                .iter()
                .filter(|call| call.function == function)
                .count()
                > 1
    };
    let innermost = calls
        .iter()
        .rev()
        .find(|call| call.name.is_some() && recurs(call.function))
        .or_else(|| calls.iter().rev().find(|call| recurs(call.function)))?;
    calls
        .iter()
        .position(|call| call.function == innermost.function)
}

impl<'a, 'project, 'sources> FileEvaluator<'a, 'project, 'sources> {
    pub fn new(
        filename: &'a str,
        project: &'project ProjectEvaluator<'sources>,
        semantic: &'a Semantic<'a>,
        program: &'a oxc_ast::ast::Program<'a>,
    ) -> Self {
        let scoping = semantic.scoping();
        let mut imports = HashMap::new();
        for statement in &program.body {
            let Statement::ImportDeclaration(declaration) = statement else {
                continue;
            };
            for specifier in declaration.specifiers.iter().flatten() {
                let (local, imported) = match specifier {
                    ImportDeclarationSpecifier::ImportSpecifier(specifier) => (
                        &specifier.local,
                        ImportedName::Named(specifier.imported.name().to_string()),
                    ),
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
                        (&specifier.local, ImportedName::Default)
                    }
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                        (&specifier.local, ImportedName::Namespace)
                    }
                };
                if let Some(symbol) = local.symbol_id.get() {
                    imports.insert(
                        symbol,
                        ImportBinding {
                            specifier: declaration.source.value.to_string(),
                            imported,
                        },
                    );
                }
            }
        }
        Self {
            filename,
            project,
            semantic,
            scoping,
            imports,
            environment: HashMap::new(),
            evaluating: HashSet::new(),
            mutations: HashMap::new(),
            helper: None,
            callee: None,
            calls: Vec::new(),
        }
    }

    pub fn evaluate(&mut self, expression: &'a Expression<'a>) -> EvalResult {
        match expression {
            Expression::BooleanLiteral(value) => EvalResult::known(value.value),
            Expression::NullLiteral(_) => EvalResult::known(serde_json::Value::Null),
            Expression::NumericLiteral(value) => serde_json::Number::from_f64(value.value)
                .map_or_else(EvalResult::unknown, |value| {
                    EvalResult::known(serde_json::Value::Number(value))
                }),
            Expression::StringLiteral(value) => {
                EvalResult::known(normalize_whitespace(value.value.as_str()))
            }
            Expression::TemplateLiteral(template) => {
                let mut output = String::new();
                let mut complete = true;
                let mut refusal = None;
                for (index, quasi) in template.quasis.iter().enumerate() {
                    let raw = quasi
                        .value
                        .cooked
                        .as_ref()
                        .map_or(quasi.value.raw.as_str(), |value| value.as_str());
                    output.push_str(raw);
                    if let Some(expression) = template.expressions.get(index) {
                        let value = self.evaluate(expression);
                        let unsure = value.nullish;
                        complete &= value.converts();
                        refusal = refusal.or(value.refusal);
                        let Some(value) = value.value.filter(|_| !unsure) else {
                            return EvalResult {
                                refusal,
                                ..EvalResult::unknown()
                            };
                        };
                        output.push_str(&to_js_string(&value));
                    }
                }
                let mut result = EvalResult::known(normalize_whitespace(&output));
                result.complete = complete;
                result.refusal = refusal;
                result
            }
            Expression::ArrayExpression(array) => {
                let mut output = Vec::new();
                let mut conditions = Vec::new();
                let mut complete = true;
                let mut refusal = None;
                // What the array holds that is not what it is. A hole and an `undefined` element
                // are held as `null`, as a `null` one is, and recorded as nullish; an element the
                // build cannot evaluate is held as `null` in its place, and recorded as not known.
                // After a spread of an unknown length nothing is where it is held, so the array is
                // open.
                let mut partial = Partial::default();
                for element in &array.elements {
                    match element {
                        oxc_ast::ast::ArrayExpressionElement::SpreadElement(spread) => {
                            let value = self.evaluate(&spread.argument);
                            complete &= value.complete;
                            refusal = refusal.or(value.refusal);
                            conditions.extend(value.conditions);
                            if let Some(serde_json::Value::Array(values)) = value.value {
                                if !partial.open {
                                    let offset = output.len();
                                    match &value.partial {
                                        Some(spread) => spread.spread_into(
                                            &mut partial,
                                            0,
                                            offset,
                                            values.len(),
                                        ),
                                        // Incomplete with nothing said of it, not even its
                                        // length: nothing from here on is where it is held.
                                        None if !value.complete => partial.open_after(offset),
                                        // Every element is exactly what it is held as.
                                        None => {}
                                    }
                                }
                                output.extend(values);
                            } else {
                                complete = false;
                                partial.open_after(output.len());
                            }
                        }
                        oxc_ast::ast::ArrayExpressionElement::Elision(_) => {
                            if !partial.open {
                                partial.write_nullish(&output.len().to_string());
                            }
                            output.push(serde_json::Value::Null)
                        }
                        _ => {
                            let value = element
                                .as_expression()
                                .map_or_else(EvalResult::unknown, |value| self.evaluate(value));
                            let decided = !value.is_undecided();
                            let exact = value.complete
                                && value.value.is_some()
                                && !value.nullish
                                && decided;
                            if !partial.open && (!exact || value.partial.is_some()) {
                                if decided {
                                    partial.write_value(&output.len().to_string(), &value);
                                } else {
                                    // Its undecided values are held under no index of its own
                                    // (`conditions`), so what is held there is not it: read by
                                    // index, `'x' in [{ x: c ? 1 : 2 }][0]` was false. What its
                                    // record says of the rest of it still holds.
                                    partial.write(
                                        &output.len().to_string(),
                                        false,
                                        undecided_record(&value),
                                    );
                                }
                            }
                            complete &= value.complete;
                            refusal = refusal.or(value.refusal);
                            conditions.extend(value.conditions);
                            output.push(value.value.unwrap_or(serde_json::Value::Null));
                        }
                    }
                }
                EvalResult {
                    value: Some(output.into()),
                    conditions,
                    complete,
                    refusal,
                    partial: (!partial.is_empty()).then(|| Arc::new(partial)),
                    nullish: false,
                }
            }
            Expression::ObjectExpression(object) => {
                let mut output = serde_json::Map::with_capacity(object.properties.len());
                let mut fragments = Fragments::default();
                let mut complete = true;
                let mut refusal = None;
                // Started by the first write that is not known; until then every property is.
                let mut partial: Option<Partial> = None;
                for property in &object.properties {
                    match property {
                        ObjectPropertyKind::ObjectProperty(property) => {
                            if property.method {
                                complete = false;
                                let known = partial.get_or_insert_default();
                                match property.key.static_name().filter(|_| !property.computed) {
                                    Some(name) => known.write(&name, false, None),
                                    None => known.open(),
                                }
                                continue;
                            }
                            // `__proto__: base` sets the prototype, not a property: whatever the
                            // base has, the object inherits, and `in` and a read of a property it
                            // does not hold see it. `null`, or anything else not an object, sets
                            // none to inherit from.
                            if !property.computed
                                && !property.shorthand
                                && property
                                    .key
                                    .static_name()
                                    .is_some_and(|name| name == "__proto__")
                            {
                                let base = self.evaluate(&property.value);
                                let object = matches!(
                                    base.value,
                                    Some(
                                        serde_json::Value::Object(_) | serde_json::Value::Array(_)
                                    )
                                );
                                if object || !base.complete || !base.conditions.is_empty() {
                                    // What it inherits is the object's too: a style object is
                                    // walked with `for…in`, which reads inherited keys.
                                    complete = false;
                                    refusal = refusal.or(base.refusal);
                                    partial
                                        .get_or_insert_default()
                                        .inherit(output.keys().chain(&fragments.keys));
                                }
                                continue;
                            }
                            let key = if property.computed {
                                property
                                    .key
                                    .as_expression()
                                    .and_then(|key| known_key(self.evaluate(key)))
                                    .map(|key| to_js_string(&key))
                            } else {
                                property.key.static_name().map(|name| name.into_owned())
                            };
                            let Some(key) = key else {
                                complete = false;
                                partial.get_or_insert_default().open();
                                continue;
                            };
                            let value = self.evaluate(&property.value);
                            complete &= value.complete;
                            refusal = refusal.or(value.refusal.clone());
                            write_property(&mut output, &mut fragments, &mut partial, key, value);
                        }
                        ObjectPropertyKind::SpreadProperty(spread) => {
                            let value = self.evaluate(&spread.argument);
                            complete &= value.complete;
                            refusal = refusal.or(value.refusal.clone());
                            // Not one object, a choice of objects whose source says their keys
                            // writes those and nothing else.
                            if !matches!(value.value, Some(serde_json::Value::Object(_)))
                                && !writes_nothing(&value)
                                && let Some(keys) = spread_keys(&spread.argument)
                            {
                                spread_keys_written(
                                    &mut output,
                                    &mut fragments,
                                    &mut partial,
                                    &keys,
                                    value.conditions,
                                );
                                continue;
                            }
                            spread_value(
                                &mut output,
                                &mut fragments,
                                &mut partial,
                                &mut complete,
                                value,
                            );
                        }
                    }
                }
                EvalResult {
                    value: Some(output.into()),
                    conditions: fragments.list,
                    complete,
                    refusal,
                    partial: partial
                        .filter(|partial| !complete || !partial.is_empty())
                        .map(Arc::new),
                    nullish: false,
                }
            }
            Expression::Identifier(identifier) => {
                if identifier.name == "undefined" {
                    return EvalResult::undefined();
                }
                let Some(reference) = identifier.reference_id.get() else {
                    return EvalResult::unknown();
                };
                let Some(symbol) = self.scoping.get_reference(reference).symbol_id() else {
                    return EvalResult::unknown();
                };
                self.evaluate_symbol(symbol)
            }
            Expression::StaticMemberExpression(member) => {
                let object = self.evaluate(&member.object);
                member_value(object, member.property.name.as_str())
            }
            Expression::ComputedMemberExpression(member) => {
                let object = self.evaluate(&member.object);
                let property = known_key(self.evaluate(&member.expression));
                let Some(property) = property.map(|value| to_js_string(&value)) else {
                    return EvalResult::unknown();
                };
                member_value(object, &property)
            }
            Expression::ParenthesizedExpression(value) => self.evaluate(&value.expression),
            Expression::TSAsExpression(value) => self.evaluate(&value.expression),
            Expression::TSSatisfiesExpression(value) => self.evaluate(&value.expression),
            Expression::TSTypeAssertion(value) => self.evaluate(&value.expression),
            Expression::TSNonNullExpression(value) => self.evaluate(&value.expression),
            Expression::TSInstantiationExpression(value) => self.evaluate(&value.expression),
            Expression::UnaryExpression(value) => {
                self.evaluate_unary(value.operator, &value.argument)
            }
            Expression::BinaryExpression(value) => {
                self.evaluate_binary(value.operator, &value.left, &value.right)
            }
            Expression::LogicalExpression(value) => self.evaluate_logical(value),
            Expression::ConditionalExpression(value) => {
                let test = self.evaluate(&value.test);
                if let Some(truthy) = test.truthiness() {
                    return if truthy {
                        self.evaluate(&value.consequent)
                    } else {
                        self.evaluate(&value.alternate)
                    };
                }
                let left = self.evaluate(&value.consequent);
                let right = self.evaluate(&value.alternate);
                let mut conditions = left.conditions;
                if let Some(value) = left.value {
                    conditions.push(value);
                }
                conditions.extend(right.conditions);
                if let Some(value) = right.value {
                    conditions.push(value);
                }
                EvalResult {
                    value: None,
                    conditions,
                    complete: left.complete && right.complete,
                    refusal: test.refusal.or(left.refusal).or(right.refusal),
                    partial: None,
                    nullish: false,
                }
            }
            Expression::CallExpression(call) => self.evaluate_call(call),
            // Every expression runs, and the value is the last one's. An earlier one the
            // evaluator cannot follow may be what changes it, as in `(track(), styles)`: then the
            // value is not complete, and nothing said of what it holds stands either.
            Expression::SequenceExpression(sequence) => {
                let Some((last, earlier)) = sequence.expressions.split_last() else {
                    return EvalResult::undefined();
                };
                let mut followed = true;
                let mut refusal = None;
                for expression in earlier {
                    let value = self.evaluate(expression);
                    followed &= value.complete;
                    refusal = refusal.or(value.refusal);
                }
                let mut result = self.evaluate(last);
                result.refusal = refusal.or(result.refusal);
                if !followed {
                    result.complete = false;
                    let own: Option<Vec<String>> = match &result.value {
                        Some(serde_json::Value::Object(object)) => Some(
                            object
                                .keys()
                                .chain(condition_keys(&result.conditions))
                                .cloned()
                                .collect(),
                        ),
                        Some(serde_json::Value::Array(_)) => Some(Vec::new()),
                        _ => None,
                    };
                    if let Some(own) = own {
                        let mut known = result.partial.as_deref().cloned().unwrap_or_default();
                        known.distrust(&own);
                        result.partial = Some(Arc::new(known));
                    }
                }
                result
            }
            Expression::ChainExpression(chain) => self.evaluate_chain(&chain.expression),
            _ => EvalResult::unknown(),
        }
    }

    /// `a?.b`, `a?.[k]` and `f?.()`.
    ///
    /// Evaluated as the plain access, except that a nullish receiver at an optional link
    /// short-circuits the *rest of the chain* to `undefined`: `o?.a.b` with `o = null` is
    /// `undefined`, not a read of `.b` off `undefined`. That is the only difference `?.` makes,
    /// so everything else is delegated to the non-optional path.
    fn evaluate_chain(&mut self, element: &'a oxc_ast::ast::ChainElement<'a>) -> EvalResult {
        use oxc_ast::ast::ChainElement;
        let link = match element {
            ChainElement::StaticMemberExpression(member) => self.chain_member(
                &member.object,
                member.optional,
                MemberKey::Static(member.property.name.as_str()),
            ),
            ChainElement::ComputedMemberExpression(member) => self.chain_member(
                &member.object,
                member.optional,
                MemberKey::Computed(&member.expression),
            ),
            ChainElement::TSNonNullExpression(value) => self.chain_link(&value.expression),
            // An optional call runs code; the non-optional call path decides whether that code
            // is evaluable, and a nullish callee is the one case `?.` adds.
            ChainElement::CallExpression(call) => {
                let callee = self.chain_link(&call.callee);
                if callee.short_circuited || (call.optional && is_nullish(&callee.result)) {
                    ChainLink::short_circuit()
                } else {
                    ChainLink::value(self.evaluate_call(call))
                }
            }
            ChainElement::PrivateFieldExpression(_) => ChainLink::value(EvalResult::unknown()),
        };
        link.result
    }

    /// One link of a chain, recursing through the links before it.
    ///
    /// A parenthesized sub-chain is not a link: `(o?.a).b` ends the inner chain at the
    /// parenthesis, so its short-circuit does not skip `.b`. Oxc represents that as a nested
    /// `ChainExpression`, which is evaluated as an ordinary value.
    fn chain_link(&mut self, expression: &'a Expression<'a>) -> ChainLink {
        match expression {
            Expression::StaticMemberExpression(member) => self.chain_member(
                &member.object,
                member.optional,
                MemberKey::Static(member.property.name.as_str()),
            ),
            Expression::ComputedMemberExpression(member) => self.chain_member(
                &member.object,
                member.optional,
                MemberKey::Computed(&member.expression),
            ),
            Expression::TSNonNullExpression(value) => self.chain_link(&value.expression),
            _ => ChainLink::value(self.evaluate(expression)),
        }
    }

    fn chain_member(
        &mut self,
        object: &'a Expression<'a>,
        optional: bool,
        key: MemberKey<'a>,
    ) -> ChainLink {
        let receiver = self.chain_link(object);
        if receiver.short_circuited || (optional && is_nullish(&receiver.result)) {
            return ChainLink::short_circuit();
        }
        let property = match key {
            MemberKey::Static(name) => name.to_string(),
            MemberKey::Computed(expression) => {
                match known_key(self.evaluate(expression)).map(|value| to_js_string(&value)) {
                    Some(property) => property,
                    None => return ChainLink::value(EvalResult::unknown()),
                }
            }
        };
        ChainLink::value(member_value(receiver.result, &property))
    }

    pub fn semantic(&self) -> &'a Semantic<'a> {
        self.semantic
    }

    pub fn is_import(&self, symbol: SymbolId) -> bool {
        self.imports.contains_key(&symbol)
    }

    pub fn evaluate_jsx_expression(&mut self, expression: &'a JSXExpression<'a>) -> EvalResult {
        expression
            .as_expression()
            .map_or_else(EvalResult::undefined, |value| self.evaluate(value))
    }

    pub fn evaluate_symbol(&mut self, symbol: SymbolId) -> EvalResult {
        if let Some(write) = self.mutation(symbol) {
            return EvalResult::refused(self.write_refusal(symbol, write));
        }
        if let Some(value) = self.environment.get(&symbol) {
            return value.clone();
        }
        if !self.evaluating.insert(symbol) {
            return EvalResult::unknown();
        }
        let result = if let Some(binding) = self.imports.get(&symbol).cloned() {
            self.project.evaluate_import(self.filename, &binding)
        } else {
            match self.semantic.symbol_declaration(symbol).kind() {
                AstKind::VariableDeclarator(declarator) => {
                    // `declare const d: string` has no initializer because its value lives
                    // somewhere the build cannot see — a global, a bundler define, another
                    // script. It is not `undefined`. Reading it as the known `undefined` a bare
                    // `let u` is dropped the property *and* reported the call complete, so the
                    // value vanished with no warning and no failure.
                    let ambient = matches!(
                        self.semantic.nodes().parent_kind(self.semantic.symbol_declaration(symbol).id()),
                        AstKind::VariableDeclaration(declaration) if declaration.declare
                    );
                    let value = match declarator.init.as_ref() {
                        Some(expression) => self.evaluate(expression),
                        None if ambient => EvalResult::unknown(),
                        None => EvalResult::undefined(),
                    };
                    // A destructured symbol denotes its property, not the declarator's entire
                    // initializer. Binding every sibling at once also mirrors JavaScript's
                    // defaults and avoids re-evaluating the same static initializer.
                    self.bind_pattern(&declarator.id, value);
                    self.environment
                        .get(&symbol)
                        .cloned()
                        .unwrap_or_else(EvalResult::unknown)
                }
                AstKind::TSEnumDeclaration(declaration) => {
                    self.evaluate_merged_enum(symbol, declaration)
                }
                // A namespace declared first, with the enum it merges with after it.
                AstKind::TSNamespaceDeclaration(_) => match self.enum_declared_later(symbol) {
                    Some(declaration) => self.evaluate_merged_enum(symbol, declaration),
                    None => EvalResult::unknown(),
                },
                _ => EvalResult::unknown(),
            }
        };
        self.evaluating.remove(&symbol);
        result
    }

    /// Whether anything in the file can change what `symbol` holds after its declaration.
    ///
    /// A binding is read from its declaration, not by running the module, so a later write
    /// goes unseen: a `let` reassigned in a branch, or a `const` object changed through
    /// `base.color = …`, `delete base.color`, `Object.assign(base, …)` or `fonts.push(…)`
    /// before a style call reads it. Any such use anywhere in the file makes the binding's
    /// value unknown, since where the write runs relative to the read is not knowable here.
    ///
    /// Reads are left alone, including passing the binding to a function: `Object.keys(base)`
    /// and `css(base)` are what a style object is for. A function that mutates what it is
    /// given, an alias written through, or a write from another module is not seen.
    pub fn is_mutated(&mut self, symbol: SymbolId) -> bool {
        self.mutation(symbol).is_some()
    }

    /// The first reference to `symbol`, in source order, through which it is written.
    fn mutation(&mut self, symbol: SymbolId) -> Option<NodeId> {
        if let Some(&mutation) = self.mutations.get(&symbol) {
            return mutation;
        }
        let nodes = self.semantic.nodes();
        let mutation = self
            .scoping
            .get_resolved_references(symbol)
            .find(|reference| reference.is_write() || mutates_through(nodes, reference.node_id()))
            .map(|reference| reference.node_id());
        self.mutations.insert(symbol, mutation);
        mutation
    }

    /// `symbol` is written at `reference`: by the statement there, read as written.
    fn write_refusal(&self, symbol: SymbolId, reference: NodeId) -> Refusal {
        let nodes = self.semantic.nodes();
        let statement = nodes
            .ancestor_kinds(reference)
            .find(|kind| kind.is_statement())
            .unwrap_or_else(|| nodes.kind(reference));
        self.refusal(
            "write",
            self.scoping.symbol_name(symbol).to_string(),
            None,
            nodes.kind(reference).span(),
            statement.span(),
        )
    }

    /// `statement`, which the evaluator does not run, in the helper whose body is running.
    fn statement_refusal(&self, statement: &Statement<'_>) -> Refusal {
        let keyword = match statement {
            Statement::SwitchStatement(_) => "switch",
            Statement::ForStatement(_) => "for",
            Statement::ForInStatement(_) => "for…in",
            Statement::ForOfStatement(_) => "for…of",
            Statement::WhileStatement(_) => "while",
            Statement::DoWhileStatement(_) => "do…while",
            Statement::TryStatement(_) => "try",
            Statement::ThrowStatement(_) => "throw",
            Statement::LabeledStatement(_) => "labeled",
            Statement::BreakStatement(_) => "break",
            Statement::ContinueStatement(_) => "continue",
            Statement::WithStatement(_) => "with",
            Statement::ClassDeclaration(_) => "class",
            Statement::TSEnumDeclaration(_) => "enum",
            Statement::DebuggerStatement(_) => "debugger",
            Statement::ExpressionStatement(_) => "expression",
            Statement::VariableDeclaration(_) => "using",
            _ => "statement",
        };
        self.refusal(
            "statement",
            keyword.to_string(),
            self.helper.as_deref().map(str::to_string),
            statement.span(),
            statement.span(),
        )
    }

    /// A refusal at `at`, in this file, showing the code at `excerpt`.
    fn refusal(
        &self,
        kind: &'static str,
        subject: String,
        helper: Option<String>,
        at: oxc_span::Span,
        excerpt: oxc_span::Span,
    ) -> Refusal {
        let source = self.semantic.source_text();
        let (line, column) = crate::line_and_column(source, at.start);
        Refusal {
            kind,
            subject,
            helper,
            excerpt: excerpt_of(&source[excerpt.start as usize..excerpt.end as usize]),
            file_path: self.filename.to_string(),
            line,
            column,
        }
    }

    /// Run `call` as the body of the helper named `name`, for a refusal inside it to name.
    pub fn with_helper<T>(
        &mut self,
        name: impl Into<Cow<'a, str>>,
        call: impl FnOnce(&mut Self) -> T,
    ) -> T {
        let name = name.into();
        let previous_callee = self.callee.replace(name.clone());
        let previous = self.helper.replace(name);
        let result = call(self);
        self.helper = previous;
        self.callee = previous_callee;
        result
    }

    /// An enum as the object its members compile to.
    ///
    /// TypeScript's rules: a member without an initializer is one more than the previous
    /// numeric member (or `0` first), and an initializer may name an earlier member bare —
    /// `B = A + 1` — which is why members are bound into scope as they are read. A string
    /// member ends auto-increment, so a bare member after one is unknown, as it is to `tsc`.
    ///
    /// Only the forward direction is held. The reverse mapping a numeric enum also carries
    /// (`Tone[0] === 'Warm'`) is not, as it would put numeric keys into every object this spreads
    /// into, so a numeric enum is known member by member and not as a whole: a read through the
    /// mapping, `Tone[Tone.Warm]`, is not known, where it was a missing key's `undefined`.
    ///
    /// Another declaration of the enum adds to it what `merge` says (`enum_redeclared`).
    ///
    /// A `declare enum` has no runtime object, so its members are not values.
    fn evaluate_enum(
        &mut self,
        declaration: &'a oxc_ast::ast::TSEnumDeclaration<'a>,
        merge: &EnumMerge,
    ) -> EvalResult {
        if declaration.declare {
            return EvalResult::unknown();
        }
        let mut object = serde_json::Map::with_capacity(declaration.body.members.len());
        let mut complete = true;
        // What is known of its members, kept once one is not.
        let mut known = Partial::default();
        let mut next: Option<f64> = Some(0.0);
        for member in &declaration.body.members {
            let name = match &member.id {
                oxc_ast::ast::TSEnumMemberName::Identifier(id) => id.name.to_string(),
                oxc_ast::ast::TSEnumMemberName::String(value)
                | oxc_ast::ast::TSEnumMemberName::ComputedString(value) => value.value.to_string(),
                oxc_ast::ast::TSEnumMemberName::ComputedTemplateString(template) => {
                    match template.single_quasi() {
                        Some(value) => value.to_string(),
                        None => {
                            complete = false;
                            continue;
                        }
                    }
                }
            };
            let value = match &member.initializer {
                Some(initializer) => {
                    let value = self.evaluate_enum_initializer(initializer, &object);
                    complete &= value.complete;
                    known.write(&name, value.complete && value.value.is_some(), None);
                    value.value
                }
                None => next
                    .and_then(serde_json::Number::from_f64)
                    .map(serde_json::Value::Number),
            };
            next = value
                .as_ref()
                .and_then(serde_json::Value::as_f64)
                .map(|number| number + 1.0);
            match value {
                Some(value) => {
                    if member.initializer.is_none() {
                        known.write(&name, true, None);
                    }
                    object.insert(name, value);
                }
                None => {
                    complete = false;
                    known.write(&name, false, None);
                }
            }
        }
        // A numeric member gives the object a key for its value too, its reverse mapping, which is
        // not held here: there, as each such value names it, though what it holds is not known.
        // Where a member is not known — its value, or its name — nor are the keys its value gives,
        // and the object is open, as it is where another declaration adds members.
        let reverse: Vec<String> = object
            .values()
            .filter_map(serde_json::Value::as_f64)
            .map(js_number_string)
            .collect();
        let mut record = if complete && !merge.open {
            for key in &reverse {
                known.write(key, false, None);
            }
            known
        } else {
            let mut record = Partial::default();
            record.open();
            for name in object.keys() {
                record.write(name, !known.unsettled.contains(name), None);
            }
            for name in &known.unsettled {
                record.write(name, false, None);
            }
            record
        };
        for name in &merge.written {
            record.write(name, false, None);
        }
        let whole = complete && !merge.open && reverse.is_empty();
        EvalResult {
            value: Some(object.into()),
            conditions: Vec::new(),
            complete: whole,
            refusal: None,
            partial: (!whole).then(|| Arc::new(record)),
            nullish: false,
        }
    }

    /// The enum `symbol` is, with what each other declaration of it adds (`enum_redeclared`).
    fn evaluate_merged_enum(
        &mut self,
        symbol: SymbolId,
        declaration: &'a oxc_ast::ast::TSEnumDeclaration<'a>,
    ) -> EvalResult {
        match self.enum_redeclared(symbol, declaration.node_id.get()) {
            Some(merge) => self.evaluate_enum(declaration, &merge),
            None => EvalResult::unknown(),
        }
    }

    /// Whether `symbol`, first declared as a namespace, is an enum it merges with — see
    /// `enum_declared_later`.
    pub(crate) fn merges_enum(&self, symbol: SymbolId) -> bool {
        self.enum_declared_later(symbol).is_some()
    }

    /// The enum a symbol first declared as a namespace is, declared after it.
    fn enum_declared_later(
        &self,
        symbol: SymbolId,
    ) -> Option<&'a oxc_ast::ast::TSEnumDeclaration<'a>> {
        let nodes = self.semantic.nodes();
        self.scoping
            .symbol_redeclarations(symbol)
            .iter()
            .find_map(
                |redeclaration| match nodes.kind(redeclaration.declaration) {
                    AstKind::TSEnumDeclaration(declaration) => Some(declaration),
                    _ => None,
                },
            )
    }

    /// What declaring the enum `symbol` again, besides at `own`, adds to it. A namespace of types
    /// alone adds nothing. A `declare`d one — a namespace, an enum — says of members the program
    /// has from elsewhere, so the enum's own are known and no others (`open`). A namespace holding
    /// values adds those it exports, which are not read here, and may add others (`open`, with
    /// each it exports `written`). Another enum adds members of its own, and nothing is known
    /// (`None`), nor of a namespace whose exports are not all named: what one added was read as a
    /// known `undefined`, and the property dropped.
    fn enum_redeclared(&self, symbol: SymbolId, own: NodeId) -> Option<EnumMerge> {
        let nodes = self.semantic.nodes();
        let mut merge = EnumMerge::default();
        for redeclaration in self.scoping.symbol_redeclarations(symbol) {
            if redeclaration.declaration == own
                || redeclaration.flags.contains(SymbolFlags::NamespaceModule)
            {
                continue;
            }
            merge.open = true;
            if redeclaration.flags.contains(SymbolFlags::Ambient) {
                continue;
            }
            let AstKind::TSNamespaceDeclaration(namespace) = nodes.kind(redeclaration.declaration)
            else {
                return None;
            };
            merge.written.extend(namespace_exports(namespace)?);
        }
        Some(merge)
    }

    /// An enum initializer, where an earlier member may be named without its enum.
    fn evaluate_enum_initializer(
        &mut self,
        initializer: &'a Expression<'a>,
        members: &serde_json::Map<String, serde_json::Value>,
    ) -> EvalResult {
        // A bare identifier inside an enum body resolves to the member of that name before any
        // outer binding. Semantic analysis does not bind it as a reference to the member, so
        // answer it here; anything else evaluates as usual.
        if let Expression::Identifier(identifier) = initializer.get_inner_expression()
            && let Some(value) = members.get(identifier.name.as_str())
        {
            return EvalResult::known(value.clone());
        }
        if let Expression::BinaryExpression(binary) = initializer.get_inner_expression() {
            let side = |this: &mut Self, expression: &'a Expression<'a>| {
                this.evaluate_enum_initializer(expression, members)
            };
            let left = side(self, &binary.left);
            let right = side(self, &binary.right);
            return self.combine_binary(binary.operator, left, right);
        }
        self.evaluate(initializer)
    }

    fn evaluate_unary(
        &mut self,
        operator: UnaryOperator,
        argument: &'a Expression<'a>,
    ) -> EvalResult {
        if operator == UnaryOperator::Void {
            return EvalResult::undefined();
        }
        let result = self.evaluate(argument);
        if operator == UnaryOperator::LogicalNot
            && let Some(truthy) = result.truthiness()
        {
            return EvalResult::known(!truthy);
        }
        // Worked out from a value the build only guessed, or one holding a part it could not decide
        // or read (`converts`), the answer is a guess too — but not what `typeof` says of an object
        // or an array that surely is one.
        let guessed = !result.converts()
            && !(operator == UnaryOperator::Typeof && result.surely_structured());
        if result.nullish {
            return EvalResult {
                refusal: result.refusal,
                ..EvalResult::unknown()
            };
        }
        let Some(value) = result.value else {
            return EvalResult {
                refusal: result.refusal,
                ..EvalResult::unknown()
            };
        };
        let mut answer = match operator {
            // Reached only for a value whose truthiness is not decided.
            UnaryOperator::LogicalNot => EvalResult::unknown(),
            UnaryOperator::UnaryPlus => number_value(&value)
                .and_then(serde_json::Number::from_f64)
                .map_or_else(EvalResult::unknown, |n| {
                    EvalResult::known(serde_json::Value::Number(n))
                }),
            UnaryOperator::UnaryNegation => number_value(&value)
                .and_then(|number| serde_json::Number::from_f64(-number))
                .map_or_else(EvalResult::unknown, |n| {
                    EvalResult::known(serde_json::Value::Number(n))
                }),
            UnaryOperator::BitwiseNot => number_value(&value)
                .map(|number| EvalResult::known(!to_int32(number)))
                .unwrap_or_else(EvalResult::unknown),
            UnaryOperator::Typeof => EvalResult::known(match value {
                serde_json::Value::Null => "object",
                serde_json::Value::Bool(_) => "boolean",
                serde_json::Value::Number(_) => "number",
                serde_json::Value::String(_) => "string",
                _ => "object",
            }),
            UnaryOperator::Delete => EvalResult::known(true),
            UnaryOperator::Void => EvalResult::undefined(),
        };
        if guessed || !answer.complete {
            answer.complete = false;
            answer.refusal = result.refusal;
        }
        answer
    }

    fn evaluate_binary(
        &mut self,
        operator: BinaryOperator,
        left: &'a Expression<'a>,
        right: &'a Expression<'a>,
    ) -> EvalResult {
        let left = self.evaluate(left);
        let right = self.evaluate(right);
        self.combine_binary(operator, left, right)
    }

    fn combine_binary(
        &mut self,
        operator: BinaryOperator,
        left: EvalResult,
        right: EvalResult,
    ) -> EvalResult {
        if left.nullish || right.nullish {
            return EvalResult {
                refusal: left.refusal.or(right.refusal),
                ..EvalResult::unknown()
            };
        }
        // `in` says for itself whether its answer is exact: it reads which keys an object has, not
        // what they hold. Any other reads all of each: `[c ? 'a' : 'b'] + 'x'` gave `x`.
        let mut complete = left.converts() && right.converts();
        // But an object or an array that surely is one is no primitive, however little of it is
        // known: `theme != null` is true of `{ color: 'red.300', shadow: compute() }`, and `===` of
        // one and any primitive false. `==` converts it beside anything but `null`.
        let primitive = |value: &EvalResult, loose: bool| {
            value.converts()
                && value.value.as_ref().is_some_and(|value| {
                    if loose {
                        value.is_null()
                    } else {
                        !value.is_object() && !value.is_array()
                    }
                })
        };
        let beside_primitive = |loose: bool| {
            (left.surely_structured() && primitive(&right, loose))
                || (right.surely_structured() && primitive(&left, loose))
        };
        match operator {
            BinaryOperator::StrictEquality | BinaryOperator::StrictInequality
                if beside_primitive(false) =>
            {
                complete = true;
            }
            BinaryOperator::Equality | BinaryOperator::Inequality if beside_primitive(true) => {
                complete = true;
            }
            _ => {}
        }
        // The left of `in` is converted to a key, as a value any other operator reads is.
        let (left_complete, right_complete) = (left.converts(), right.complete);
        let refusal = left.refusal.or(right.refusal);
        let receiver = right.partial;
        let right_conditions = right.conditions;
        let (Some(left), Some(right)) = (left.value, right.value) else {
            return EvalResult {
                refusal,
                ..EvalResult::unknown()
            };
        };
        let value = match operator {
            BinaryOperator::Addition => add_values(&left, &right),
            BinaryOperator::Subtraction => numeric_binary(&left, &right, |a, b| a - b),
            BinaryOperator::Multiplication => numeric_binary(&left, &right, |a, b| a * b),
            BinaryOperator::Division => numeric_binary(&left, &right, |a, b| a / b),
            BinaryOperator::Remainder => numeric_binary(&left, &right, |a, b| a % b),
            BinaryOperator::Exponential => numeric_binary(&left, &right, f64::powf),
            BinaryOperator::StrictEquality => strict_equals(&left, &right).map(Into::into),
            BinaryOperator::StrictInequality => {
                strict_equals(&left, &right).map(|equal| (!equal).into())
            }
            BinaryOperator::Equality => loose_equals(&left, &right).map(Into::into),
            BinaryOperator::Inequality => loose_equals(&left, &right).map(|equal| (!equal).into()),
            BinaryOperator::LessThan => compare_binary(&left, &right, |a, b| a < b),
            BinaryOperator::LessEqualThan => compare_binary(&left, &right, |a, b| a <= b),
            BinaryOperator::GreaterThan => compare_binary(&left, &right, |a, b| a > b),
            BinaryOperator::GreaterEqualThan => compare_binary(&left, &right, |a, b| a >= b),
            BinaryOperator::BitwiseOR => integer_binary(&left, &right, |a, b| (a | b).into()),
            BinaryOperator::BitwiseXOR => integer_binary(&left, &right, |a, b| (a ^ b).into()),
            BinaryOperator::BitwiseAnd => integer_binary(&left, &right, |a, b| (a & b).into()),
            BinaryOperator::ShiftLeft => {
                integer_binary(&left, &right, |a, b| a.wrapping_shl(shift_count(b)).into())
            }
            BinaryOperator::ShiftRight => {
                integer_binary(&left, &right, |a, b| a.wrapping_shr(shift_count(b)).into())
            }
            // Unsigned: `-1 >>> 0` is 4294967295.
            BinaryOperator::ShiftRightZeroFill => {
                integer_binary(&left, &right, |a, b| ((a as u32) >> shift_count(b)).into())
            }
            // An own property is there; one the prototype has is too, which is not guessed.
            //
            // Each answer is exact on its own grounds, which an object known only in part may
            // still have: a spread of something unknown writes over keys and removes none, so one
            // the object holds is there whatever it wrote — unless code the build could not follow
            // ran, which may have deleted it (`Partial::distrust`). That a key is not there is
            // exact only of an object holding every key it has.
            BinaryOperator::In => {
                let key = to_js_string(&left);
                let keyed = right_complete || receiver.as_ref().is_some_and(|known| !known.open);
                let held = |known: &Partial| !known.unsettled.contains(&key);
                let (answer, exact) = match right {
                    serde_json::Value::Object(ref object) if object.contains_key(&key) => {
                        (Some(true), keyed || receiver.as_deref().is_some_and(held))
                    }
                    // Written as `undefined`: there, though the value leaves it out.
                    serde_json::Value::Object(_)
                        if receiver
                            .as_ref()
                            .is_some_and(|known| known.undefined.contains(&key)) =>
                    {
                        (Some(true), true)
                    }
                    // Written with a value the build could not evaluate.
                    serde_json::Value::Object(_)
                        if receiver
                            .as_ref()
                            .is_some_and(|known| known.unsettled.contains(&key)) =>
                    {
                        (Some(true), keyed)
                    }
                    // Under a value the object could not decide between: a key written with one
                    // of several is there whichever it is. A branch of a spread it could not
                    // choose may hold the key or not, but such a spread opens the object, so
                    // after one only a key written since is surely there.
                    serde_json::Value::Object(_)
                        if condition_keys(&right_conditions).any(|written| *written == key) =>
                    {
                        let settled = receiver
                            .as_ref()
                            .is_some_and(|known| known.open && known.settled.contains(&key));
                        // A guess has no record and is not complete: its conditions may be what it
                        // is instead, a branch's value lifted by a read, not fragments of it.
                        let written = settled
                            || receiver
                                .as_ref()
                                .map_or(right_complete, |known| !known.open);
                        (written.then_some(true), keyed || settled)
                    }
                    // After a spread or a computed key the build could not read, any may be.
                    serde_json::Value::Object(_)
                        if receiver.as_ref().is_some_and(|known| known.open) =>
                    {
                        (None, false)
                    }
                    serde_json::Value::Object(_) if !OBJECT_PROTOTYPE.contains(&key.as_str()) => {
                        (Some(false), keyed)
                    }
                    // A hole is no property at all, so `0 in [, 2]` is false, and it is held as
                    // `null` and recorded nullish, like an `undefined` element, which is one. An
                    // element whose value is not known is there, unless a spread of unknown length
                    // came before it, which opened the record.
                    serde_json::Value::Array(ref array) => match array_index(&key) {
                        Some(index)
                            if receiver.as_ref().is_none_or(|known| {
                                (known.knows(&key) || !known.open || index < known.known_prefix)
                                    && !known.nullish.contains(&key)
                            }) =>
                        {
                            let placed = receiver.as_ref().is_some_and(|known| {
                                known.knows(&key) || !known.open || index < known.known_prefix
                            });
                            (Some(index < array.len()), keyed || placed)
                        }
                        // Of an array it surely is: one a spread may have written over may not be.
                        _ if key == "length" => (Some(true), right_complete || receiver.is_some()),
                        None if !may_be_inherited(&key) => (Some(false), keyed),
                        _ => (None, false),
                    },
                    _ => (None, false),
                };
                complete = left_complete && exact;
                answer.map(serde_json::Value::Bool)
            }
            BinaryOperator::Instanceof => None,
        };
        match value {
            Some(value) => EvalResult {
                value: Some(value),
                conditions: Vec::new(),
                complete,
                refusal,
                partial: None,
                nullish: false,
            },
            None => EvalResult {
                refusal,
                ..EvalResult::unknown()
            },
        }
    }

    fn evaluate_logical(&mut self, expression: &'a LogicalExpression<'a>) -> EvalResult {
        let left = self.evaluate(&expression.left);
        // `undefined` decides a choice as surely as a value does: it is falsy, and nullish.
        // `o.display ?? 'block'` on an option nobody passed used to stay undecided.
        // As a test decides (`truthiness`): not on a value the build only guessed.
        let select_right = match &left.value {
            Some(_) if left.surely_structured() => {
                Some(expression.operator == LogicalOperator::And)
            }
            Some(value) if left.decides() => Some(match expression.operator {
                LogicalOperator::Or => !truthy(value),
                LogicalOperator::And => truthy(value),
                LogicalOperator::Coalesce => value.is_null(),
            }),
            None if left.is_undefined() => Some(expression.operator != LogicalOperator::And),
            _ => None,
        };
        if let Some(select_right) = select_right {
            return if select_right {
                self.evaluate(&expression.right)
            } else {
                left
            };
        }
        let right = self.evaluate(&expression.right);
        let mut conditions = left.conditions;
        conditions.extend(right.conditions);
        if let Some(value) = right.value {
            conditions.push(value);
        }
        EvalResult {
            value: None,
            conditions,
            complete: left.complete && right.complete,
            refusal: left.refusal.or(right.refusal),
            partial: None,
            nullish: false,
        }
    }

    fn evaluate_call(&mut self, call: &'a CallExpression<'a>) -> EvalResult {
        let mut arguments = Vec::with_capacity(call.arguments.len());
        // Where the first spread of unknown length came, and why its length is not known — see
        // `positional`.
        let mut positioned = None;
        for argument in &call.arguments {
            let Argument::SpreadElement(spread) = argument else {
                arguments.push(
                    argument
                        .as_expression()
                        .map_or_else(EvalResult::unknown, |argument| self.evaluate(argument)),
                );
                continue;
            };
            // Of a spread whose length is not known, neither is what a parameter from here on is
            // given: it used to be `undefined`, a parameter given nothing. It stands as one value
            // not known to a call that reads its arguments in order — `Object.assign` writes each
            // source whatever came before it — and a helper, which takes them by position, is
            // given none from here on (`positional`).
            match spread_arguments(self.evaluate(&spread.argument)) {
                Ok(elements) => arguments.extend(elements),
                Err(refusal) => {
                    positioned = positioned.or(Some((arguments.len(), refusal.clone())));
                    arguments.push(EvalResult {
                        refusal,
                        ..EvalResult::unknown()
                    });
                }
            }
        }

        // `x.join()` on an `x` the evaluator refused is unknown for that reason — unless a path
        // below calls it anyway, as it does a method on an object literal.
        let mut receiver_refusal = None;
        if let Expression::StaticMemberExpression(member) = &call.callee
            && member.property.name == "join"
        {
            let array = self.evaluate(&member.object);
            // `undefined` joins with `,` and `null` with `null`.
            if arguments.first().is_some_and(|argument| argument.nullish) {
                return EvalResult::unknown();
            }
            let separator = arguments
                .first()
                .and_then(|argument| argument.value.as_ref())
                .map_or_else(|| ",".to_string(), to_js_string);
            // Of an array holding an element it could not decide between, that element was
            // written as nothing: `[c ? 'a' : 'b', 'x'].join('-')` gave `-x`.
            let converts = array.converts() && arguments.iter().all(EvalResult::converts);
            if let Some(serde_json::Value::Array(values)) = array.value {
                return EvalResult {
                    value: Some(
                        values
                            .iter()
                            .map(joined)
                            .collect::<Vec<_>>()
                            .join(&separator)
                            .into(),
                    ),
                    conditions: Vec::new(),
                    complete: converts,
                    refusal: array.refusal.or_else(|| {
                        arguments
                            .iter()
                            .find_map(|argument| argument.refusal.clone())
                    }),
                    partial: None,
                    nullish: false,
                };
            }
            receiver_refusal = array.refusal;
        }

        if let Some((symbol, members)) = callee_symbol_and_members(&call.callee, self.scoping) {
            if let Some(binding) = self.imports.get(&symbol).cloned() {
                if let Some(entrypoint) = self.project.entrypoint(&binding.specifier) {
                    let mut path = match &binding.imported {
                        ImportedName::Named(name) => vec![name.clone()],
                        ImportedName::Namespace => Vec::new(),
                        ImportedName::Default => return EvalResult::unknown(),
                    };
                    path.extend(members.iter().cloned());
                    if entrypoint.kind == "token"
                        && path.first().is_some_and(|name| name == "token")
                    {
                        let is_value = path.get(1).is_some_and(|name| name == "value");
                        // A path the build only guessed, or could not wholly read, is not the one
                        // the runtime looks up: `colors.${o.tone}.300` with `o` a default a spread
                        // may write over compiled to the default's token, and a join over a part not
                        // decided to none.
                        let Some(token_path) = arguments
                            .first()
                            .filter(|value| value.decides() && !value.nullish)
                            .and_then(|value| value.value.as_ref())
                            .and_then(|value| value.as_str())
                        else {
                            return EvalResult {
                                refusal: arguments.first().and_then(|value| value.refusal.clone()),
                                ..EvalResult::unknown()
                            };
                        };
                        return self
                            .project
                            .token(token_path, is_value)
                            .map_or_else(EvalResult::undefined, EvalResult::known);
                    }
                    if entrypoint.kind == "css"
                        && path.first().is_some_and(|name| name == "fallback")
                    {
                        // `fallback(${values.join(', ')})`, which writes `null` and `undefined` as
                        // nothing. Of a value not known, or one of several, neither is what it
                        // writes: it was taken for `undefined`, and the property dropped.
                        if arguments
                            .iter()
                            .any(|value| !value.complete || value.is_undecided())
                        {
                            return EvalResult {
                                refusal: arguments.iter().find_map(|value| value.refusal.clone()),
                                ..EvalResult::unknown()
                            };
                        }
                        return EvalResult::known(format!(
                            "fallback({})",
                            arguments
                                .iter()
                                .map(|value| value.value.as_ref().map_or_else(String::new, joined))
                                .collect::<Vec<_>>()
                                .join(", ")
                        ));
                    }
                    if path.get(1).is_some_and(|name| name == "raw") {
                        // What holds no style is left out, as `compactStyles` leaves it, and an
                        // array throws there. Of one style object left, that object, as
                        // `mergeCss` gives it back; of more, their merge, which was read as the
                        // first of them. Merged here for the rules each holds, and not complete:
                        // the runtime's merge is not this one.
                        let mut styles: Vec<EvalResult> = arguments
                            .into_iter()
                            .filter(|style| !holds_no_style(style))
                            .collect();
                        if styles
                            .iter()
                            .any(|style| matches!(style.value, Some(serde_json::Value::Array(_))))
                        {
                            return EvalResult::unknown();
                        }
                        return match styles.len() {
                            0 => EvalResult::known(serde_json::Map::new()),
                            1 => styles.remove(0),
                            _ => merged_styles(styles),
                        };
                    }
                }
                if members.is_empty() {
                    return self.project.call_imported(
                        self.filename,
                        &binding,
                        positional(arguments, positioned),
                    );
                }
            }
            if members.is_empty() {
                return self.call_symbol(symbol, positional(arguments, positioned));
            }
            // `helpers.size('sm')` on a local object literal. Values evaluate to JSON, which
            // cannot hold a function, so the callee is found in the source instead: walk the
            // member path through object-literal initializers to the property's expression and
            // call that. Anything the walk cannot follow is unknown, as before.
            if !self.imports.contains_key(&symbol)
                && !self.is_mutated(symbol)
                && let Some(callee) = self.object_member_expression(symbol, &members)
            {
                let name = format!("{}.{}", self.scoping.symbol_name(symbol), members.join("."));
                let arguments = positional(arguments, positioned);
                return self.with_helper(name, |evaluator| {
                    evaluator.call_expression_value(callee, arguments)
                });
            }
        }

        // `(() => ({ … }))()` — a function written in place and called there.
        if matches!(
            crate::fold::exact::unwrap(&call.callee),
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
        ) {
            return self.call_expression_value(
                crate::fold::exact::unwrap(&call.callee),
                positional(arguments, positioned),
            );
        }

        // Object.assign({}, a, b) is common in helper modules and remains deterministic.
        if global_callee_path(&call.callee).as_deref()
            == Some(&["Object".to_string(), "assign".to_string()][..])
        {
            // Onto `null` or `undefined` it throws, and the call gives nothing.
            if arguments.first().is_none_or(|target| {
                target.nullish
                    || target.is_undefined()
                    || (target.complete && target.value == Some(serde_json::Value::Null))
            }) {
                return EvalResult::unknown();
            }
            let mut output = serde_json::Map::new();
            let mut fragments = Fragments::default();
            let mut complete = true;
            let mut refusal = None;
            // Each source is read as a spread of it is.
            let mut partial: Option<Partial> = None;
            for argument in arguments {
                complete &= argument.complete;
                refusal = refusal.or(argument.refusal.clone());
                spread_value(
                    &mut output,
                    &mut fragments,
                    &mut partial,
                    &mut complete,
                    argument,
                );
            }
            return EvalResult {
                value: Some(output.into()),
                conditions: fragments.list,
                complete,
                refusal,
                partial: partial
                    .filter(|partial| !complete || !partial.is_empty())
                    .map(Arc::new),
                nullish: false,
            };
        }
        EvalResult {
            refusal: receiver_refusal,
            ..EvalResult::unknown()
        }
    }

    pub fn call_symbol(&mut self, symbol: SymbolId, arguments: Vec<EvalResult>) -> EvalResult {
        // Reassigned, the function called may not be the one declared. A property written onto
        // it, like `displayName`, does not change what calling it returns.
        if self.scoping.symbol_is_mutated(symbol)
            && let Some(write) = self
                .scoping
                .get_resolved_references(symbol)
                .find(|reference| reference.is_write())
        {
            let write = write.node_id();
            return EvalResult::refused(self.write_refusal(symbol, write));
        }
        if let Some(binding) = self.imports.get(&symbol).cloned() {
            return self
                .project
                .call_imported(self.filename, &binding, arguments);
        }
        let scoping: &'a Scoping = self.scoping;
        self.with_helper(scoping.symbol_name(symbol), |evaluator| {
            match evaluator.semantic.symbol_declaration(symbol).kind() {
                AstKind::Function(function) => evaluator.call_function(function, arguments),
                AstKind::VariableDeclarator(declarator) => declarator
                    .init
                    .as_ref()
                    .map_or_else(EvalResult::unknown, |expression| {
                        evaluator.call_expression_value(expression, arguments)
                    }),
                _ => EvalResult::unknown(),
            }
        })
    }

    /// The source expression at `symbol.a.b`, following object-literal initializers only.
    ///
    /// `const o = { a: { f: () => 1 } }` gives `() => 1` for `["a", "f"]`. A spread, a
    /// computed key, a shorthand or a non-literal anywhere on the path ends the walk, since the
    /// value there is no longer written in this file where the walk can see it.
    fn object_member_expression(
        &self,
        symbol: SymbolId,
        members: &[String],
    ) -> Option<&'a Expression<'a>> {
        let AstKind::VariableDeclarator(declarator) =
            self.semantic.symbol_declaration(symbol).kind()
        else {
            return None;
        };
        // Only a plain binding: a destructured name does not denote the whole initializer.
        declarator.id.get_binding_identifier()?;
        let mut current = declarator.init.as_ref()?;
        for member in members {
            let Expression::ObjectExpression(object) = current.get_inner_expression() else {
                return None;
            };
            // The last property of that name wins, as in JavaScript — unless something written after
            // it may write it again: a spread, or a key the walk cannot name. Searching past them
            // called `{ color: () => 'red.300', ...props }.color` whatever `props` held.
            let mut found = None;
            for property in object.properties.iter().rev() {
                let ObjectPropertyKind::ObjectProperty(property) = property else {
                    return None;
                };
                if property.computed {
                    return None;
                }
                if property
                    .key
                    .static_name()
                    .is_some_and(|name| name == member.as_str())
                {
                    if property.shorthand || property.kind != oxc_ast::ast::PropertyKind::Init {
                        return None;
                    }
                    found = Some(&property.value);
                    break;
                }
            }
            current = found?;
        }
        Some(current)
    }

    pub fn call_expression_value(
        &mut self,
        expression: &'a Expression<'a>,
        arguments: Vec<EvalResult>,
    ) -> EvalResult {
        match expression {
            Expression::ArrowFunctionExpression(function) => self.call_arrow(function, arguments),
            Expression::FunctionExpression(function) => self.call_function(function, arguments),
            Expression::Identifier(identifier) => {
                let Some(reference) = identifier.reference_id.get() else {
                    return EvalResult::unknown();
                };
                let Some(symbol) = self.scoping.get_reference(reference).symbol_id() else {
                    return EvalResult::unknown();
                };
                self.call_symbol(symbol, arguments)
            }
            Expression::ParenthesizedExpression(value) => {
                self.call_expression_value(&value.expression, arguments)
            }
            Expression::TSAsExpression(value) => {
                self.call_expression_value(&value.expression, arguments)
            }
            Expression::TSSatisfiesExpression(value) => {
                self.call_expression_value(&value.expression, arguments)
            }
            _ => EvalResult::unknown(),
        }
    }

    pub fn call_function(
        &mut self,
        function: &'a Function<'a>,
        arguments: Vec<EvalResult>,
    ) -> EvalResult {
        let Some(body) = function.body.as_deref() else {
            return EvalResult::unknown();
        };
        self.run_call(
            std::ptr::from_ref(function) as usize,
            function.span,
            &function.params,
            arguments,
            |evaluator| {
                evaluator
                    .execute_statements(&body.statements)
                    .unwrap_or_else(EvalResult::undefined)
            },
        )
    }

    fn call_arrow(
        &mut self,
        function: &'a ArrowFunctionExpression<'a>,
        arguments: Vec<EvalResult>,
    ) -> EvalResult {
        self.run_call(
            std::ptr::from_ref(function) as usize,
            function.span,
            &function.params,
            arguments,
            |evaluator| match &function.body {
                ArrowFunctionBody::FunctionBody(body) => evaluator
                    .execute_statements(&body.statements)
                    .unwrap_or_else(EvalResult::undefined),
                _ => function
                    .body
                    .as_expression()
                    .map_or_else(EvalResult::unknown, |body| evaluator.evaluate(body)),
            },
        )
    }

    /// Run `body` as a call of the function at `function` — its node, by address — with
    /// `arguments` bound to `parameters`, unless `enter_call` refuses it.
    fn run_call(
        &mut self,
        function: usize,
        at: oxc_span::Span,
        parameters: &'a FormalParameters<'a>,
        arguments: Vec<EvalResult>,
        body: impl FnOnce(&mut Self) -> EvalResult,
    ) -> EvalResult {
        let name = self.callee.take();
        let depth = match self.enter_call(function, at, name.as_deref(), &arguments) {
            Ok(depth) => depth,
            Err(refused) => return refused,
        };
        let environment = self.environment.clone();
        let arguments = self.bind_parameters(parameters, arguments);
        self.calls.push(ActiveCall {
            function,
            at,
            name,
            arguments,
            fingerprint: std::cell::OnceCell::new(),
            environment,
            refused: None,
        });
        let result = body(self);
        self.project.call_depth.set(depth);
        let call = self.calls.pop().expect("the call pushed above");
        self.environment = call.environment;
        // Abandoned, every call running returns the refusal, until the outermost one has.
        self.name_abandoned(call.function);
        let abandoned = if depth == 0 {
            self.project
                .abandoned
                .take()
                .map(|abandoned| abandoned.refusal)
        } else {
            self.project
                .abandoned
                .borrow()
                .as_ref()
                .map(|abandoned| abandoned.refusal.clone())
        };
        abandoned.or(call.refused).unwrap_or(result)
    }

    /// Name the recursion an abandoned call went through, once this module's calls show it — see
    /// `Abandoned::named`. `function` is the call returning, which is no longer among them.
    fn name_abandoned(&self, function: usize) {
        let mut abandoned = self.project.abandoned.borrow_mut();
        let Some(state) = abandoned.as_mut().filter(|state| !state.named) else {
            return;
        };
        let Some(recursion) = recursion_at(&self.calls, function, false) else {
            return;
        };
        let subject = state
            .refusal
            .refusal
            .as_ref()
            .map_or_else(String::new, |refusal| refusal.subject.clone());
        let at = self.calls[recursion].at;
        state.refusal = self.recursion_refusal(&subject, Some(recursion), None, at);
        state.named = true;
    }

    /// Count a helper call in, or refuse to follow it. Returns the depth to restore when the call
    /// is done.
    ///
    /// A helper recursing on a value the build cannot read — `nest(props.depth)` — never reaches
    /// its base case, and following it overflowed the stack: the process died, dev server and
    /// all, with no message. So a call is refused when
    ///
    /// - the helper is already running with arguments, and an environment, it cannot be told
    ///   apart from: whatever that call did to reach this one, this one will do again. `d - 1` is
    ///   as unknown as `d`, and JavaScript, too, recurses on the same arguments until the stack
    ///   overflows. The recursion gives nothing: its outermost call returns the refusal, not what
    ///   it had built, which is not what the helper returns;
    /// - calls nest past `MAX_CALL_DEPTH`, for a recursion whose arguments change every time
    ///   without reaching its base case, or one that would end deeper than that;
    /// - the outermost call has made `MAX_CALLS`, for one that branches.
    ///
    /// Past either limit, the whole outermost call is abandoned, in every file it reached: each
    /// call running returns the refusal, and none is followed until it has. A recursion that
    /// branches would otherwise go as deep down every branch, and what is left is not what any of
    /// them returns.
    ///
    /// `function` is the helper's node, by address, `at` where it is, and `name` its name.
    fn enter_call(
        &mut self,
        function: usize,
        at: oxc_span::Span,
        name: Option<&str>,
        arguments: &[EvalResult],
    ) -> Result<u32, EvalResult> {
        let abandoned = self
            .project
            .abandoned
            .borrow()
            .as_ref()
            .map(|abandoned| abandoned.refusal.clone());
        if let Some(abandoned) = abandoned {
            // An export evaluated while the abandoned call unwinds — a property after the one
            // refused — is cut short by this, not by the limit, so it may not be cached either.
            self.project.cut_short_within_calls();
            return Err(abandoned);
        }
        if let Some(refused) = self.calls.iter().find_map(|call| call.refused.clone()) {
            return Err(refused);
        }
        let depth = self.project.call_depth.get();
        if depth == 0 {
            self.project.call_count.set(0);
        }
        // Against what the running call's body could read when it made the call still running
        // inside it: its parameters bound. Called by it directly, this call has nothing else to
        // tell it apart from that one but its arguments.
        let mut next = None;
        let repeated = self.calls.iter().enumerate().any(|(index, call)| {
            if call.function != function || call.arguments.len() != arguments.len() {
                return false;
            }
            // Where its parameters are bound: the environment the call inside it saved, or for the
            // innermost, the one running.
            let bound = self
                .calls
                .get(index + 1)
                .map_or(&self.environment, |inner| &inner.environment);
            if call
                .arguments
                .iter()
                .any(|argument| argument.read(bound).is_none())
            {
                return false;
            }
            *call.fingerprint.get_or_init(|| {
                fingerprint(
                    call.arguments
                        .iter()
                        .filter_map(|argument| argument.read(bound)),
                )
            }) == *next.get_or_insert_with(|| fingerprint(arguments))
                && call
                    .arguments
                    .iter()
                    .filter_map(|argument| argument.read(bound))
                    .zip(arguments)
                    .all(|(running, next)| running.same_as(next))
                && same_environment(bound, &self.environment)
        });
        if repeated {
            // Found among this file's calls alone, so wherever the evaluation started, it stops
            // here: unlike the limits below, what it gives may be cached.
            let recursion = recursion_at(&self.calls, function, true);
            let refused = self.recursion_refusal("loop", recursion, name, at);
            if let Some(index) = recursion {
                self.calls[index].refused = Some(refused.clone());
            }
            return Err(refused);
        }
        let subject = if depth >= MAX_CALL_DEPTH {
            "depth"
        } else if self.project.call_count.get() >= MAX_CALLS {
            "calls"
        } else {
            self.project.count_call(depth);
            return Ok(depth);
        };
        // When this module's calls do not show the recursion, a module returned to will.
        let recursion = recursion_at(&self.calls, function, false);
        let refused = self.recursion_refusal(subject, recursion, name, at);
        // Depth and count are counted from the outermost call, so no export asked for inside one
        // may be cached with it.
        self.project.cut_short_within_calls();
        *self.project.abandoned.borrow_mut() = Some(Abandoned {
            refusal: refused.clone(),
            named: recursion.is_some(),
        });
        Err(refused)
    }

    /// A recursion refused, for `subject`, named for its outermost call — `recursion`, an index
    /// into the calls running — rather than for whichever of its helpers was being called: through
    /// two, `a` calling `b` calling `a`, it may be either. Without one, the helper called, named
    /// `name` at `at`.
    fn recursion_refusal(
        &self,
        subject: &str,
        recursion: Option<usize>,
        name: Option<&str>,
        at: oxc_span::Span,
    ) -> EvalResult {
        let (name, at) = recursion.map_or((name, at), |index| {
            (self.calls[index].name.as_deref(), self.calls[index].at)
        });
        EvalResult::refused(self.refusal(
            "recursion",
            subject.to_string(),
            name.map(str::to_string),
            at,
            at,
        ))
    }

    /// Bind what a call was given to its parameters, and say how each argument is read back — see
    /// `Given`.
    fn bind_parameters(
        &mut self,
        parameters: &'a FormalParameters<'a>,
        arguments: Vec<EvalResult>,
    ) -> Vec<Given> {
        // From a spread of unknown length on, which argument a parameter is given is not known.
        let unplaced = arguments.iter().position(EvalResult::is_unplaced);
        let placed = unplaced.unwrap_or(arguments.len());
        let unplaced_refusal = unplaced.and_then(|index| arguments[index].refusal.clone());
        let not_placed = || EvalResult {
            refusal: unplaced_refusal.clone(),
            ..EvalResult::unknown()
        };
        // A name with no default holds what it is given — but only the last of it, bound twice as
        // sloppy code may, and only until a `var` of its name in the body binds it again.
        let scoping = self.scoping;
        let name = |parameter: &oxc_ast::ast::FormalParameter<'_>| match (
            &parameter.pattern,
            &parameter.initializer,
        ) {
            (BindingPattern::BindingIdentifier(identifier), None) => identifier
                .symbol_id
                .get()
                .filter(|&symbol| scoping.symbol_redeclarations(symbol).is_empty()),
            _ => None,
        };
        let once = |symbol: SymbolId| {
            parameters
                .items
                .iter()
                .filter(|parameter| name(parameter) == Some(symbol))
                .count()
                == 1
        };
        let mut given = Vec::with_capacity(arguments.len());
        let mut arguments = arguments.into_iter();
        for (index, parameter) in parameters.items.iter().enumerate() {
            let argument = (index < placed).then(|| arguments.next()).flatten();
            let mut value = match argument {
                Some(argument) => match name(parameter).filter(|&symbol| once(symbol)) {
                    Some(symbol) => {
                        given.push(Given::Bound(symbol));
                        argument
                    }
                    None => {
                        given.push(Given::Held(argument.clone()));
                        argument
                    }
                },
                None if unplaced.is_some() => not_placed(),
                None => EvalResult::undefined(),
            };
            if let Some(initializer) = parameter.initializer.as_deref() {
                // For `undefined`, and not for a value one of several: `(x = 'g') => x` given
                // `c ? 'r' : 'b'` was read as `'g'`.
                if value.is_undefined() {
                    value = self.evaluate(initializer);
                } else if value.nullish {
                    // A hole passed for it may be the `undefined` the default stands in for.
                    value = EvalResult {
                        refusal: value.refusal,
                        ..EvalResult::unknown()
                    };
                } else if value.value.is_none()
                    && !value.conditions.is_empty()
                    && runs_nothing(initializer)
                {
                    // One of several values, `undefined` perhaps among them — a choice keeps no
                    // branch that is — so the default may stand in for one: its rules are
                    // written too, and nothing is decided. Only a default that runs no code: a
                    // call the runtime never makes here could cut the whole call short.
                    let default = self.evaluate(initializer);
                    value.conditions.extend(default.data());
                }
            }
            self.bind_pattern(&parameter.pattern, value);
        }
        // What no parameter was given, and from a spread of unknown length on, what none is: held.
        let values: Vec<EvalResult> = arguments.collect();
        if let Some(rest) = &parameters.rest
            && unplaced.is_some()
        {
            self.bind_pattern(&rest.rest.argument, not_placed());
        } else if let Some(rest) = &parameters.rest {
            let values = &values[..];
            // An array holds its elements' undecided values under no index of theirs, so the rest
            // holds none of them, and an element with any is not known: spread on into another
            // call, it passed as exact what it had lost (`merge(...styles)`). The others still
            // are, and so is how many there are — `undefined` among them, held as an array literal
            // holds it, as a `null` that may be `undefined`: `(...ys) => ys.join('-')` given it
            // and `'4'` writes `-4`, where the rest was not known at all.
            let complete = values.iter().all(|value| value.complete);
            // An undecided element is held as what is known of it (`undecided_record`), its
            // undecided keys not known: as what it holds without them it was read for what it is —
            // `'size' in args[0]` false. One of which nothing is known is held as `null`, as one
            // not known at all is. A value read off an array is not undecided for the choices it
            // carries of its siblings' (`is_undecided`): it was held as `null`, so `xs.join(' ')`
            // given `space[1]` and `space[2]` wrote a space.
            let records: Vec<Option<Arc<Partial>>> = values
                .iter()
                .map(|value| {
                    value
                        .is_undecided()
                        .then(|| undecided_record(value))
                        .flatten()
                })
                .collect();
            let value = complete.then(|| {
                values
                    .iter()
                    .zip(&records)
                    .map(|(value, record)| {
                        value
                            .value
                            .clone()
                            .filter(|_| !value.is_undecided() || record.is_some())
                            .unwrap_or(serde_json::Value::Null)
                    })
                    .collect::<Vec<_>>()
                    .into()
            });
            let mut partial = Partial::default();
            let mut decided = true;
            for (index, (value, record)) in values.iter().zip(records).enumerate() {
                if value.is_undecided() {
                    decided = false;
                    partial.write(&index.to_string(), false, record);
                } else if value.nullish || value.partial.is_some() || value.is_undefined() {
                    partial.write_value(&index.to_string(), value);
                }
            }
            self.bind_pattern(
                &rest.rest.argument,
                EvalResult {
                    value,
                    conditions: Vec::new(),
                    complete: complete && decided,
                    refusal: values.iter().find_map(|value| value.refusal.clone()),
                    partial: (complete && !partial.is_empty()).then(|| Arc::new(partial)),
                    nullish: false,
                },
            );
        }
        given.extend(values.into_iter().map(Given::Held));
        given
    }

    fn bind_pattern(&mut self, pattern: &'a BindingPattern<'a>, value: EvalResult) {
        match pattern {
            BindingPattern::BindingIdentifier(identifier) => {
                if let Some(symbol) = identifier.symbol_id.get() {
                    self.environment.insert(symbol, value);
                }
            }
            BindingPattern::AssignmentPattern(pattern) => {
                let value = if value.is_undefined() {
                    self.evaluate(&pattern.right)
                } else if value.nullish {
                    // The default stands in for `undefined`, and a hole held as `null` does not
                    // say whether it is one.
                    EvalResult {
                        refusal: value.refusal,
                        ..EvalResult::unknown()
                    }
                } else if value.value.is_none()
                    && !value.conditions.is_empty()
                    && runs_nothing(&pattern.right)
                {
                    // One of several values, `undefined` perhaps among them (`bind_parameters`).
                    let default = self.evaluate(&pattern.right);
                    let mut value = value;
                    value.conditions.extend(default.data());
                    value
                } else {
                    value
                };
                self.bind_pattern(&pattern.left, value);
            }
            BindingPattern::ObjectPattern(pattern) => {
                let mut consumed = Vec::new();
                let mut unresolved = false;
                for property in &pattern.properties {
                    let key = if property.computed {
                        property
                            .key
                            .as_expression()
                            .and_then(|key| known_key(self.evaluate(key)))
                            .map(|value| to_js_string(&value))
                    } else {
                        property.key.static_name().map(|name| name.into_owned())
                    };
                    match &key {
                        Some(key) => consumed.push(key.clone()),
                        // Which one it took is not known, so neither is what the rest holds.
                        None => unresolved = true,
                    }
                    let child = key
                        .map_or_else(EvalResult::unknown, |key| member_value(value.clone(), &key));
                    self.bind_pattern(&property.value, child);
                }
                if let Some(rest) = &pattern.rest {
                    let mut remainder = value.clone();
                    remainder.value = match remainder.value {
                        Some(serde_json::Value::Object(mut object)) => {
                            for key in &consumed {
                                object.shift_remove(key);
                            }
                            Some(object.into())
                        }
                        _ => None,
                    };
                    // Nor anything the object said of the properties the pattern took: a key it
                    // wrote as `undefined` would otherwise be written over a later object's.
                    if let Some(known) = remainder.partial.take() {
                        let mut known = (*known).clone();
                        for key in &consumed {
                            known.forget(key);
                        }
                        // What was not known was under a key the pattern took.
                        if known.is_empty() && remainder.value.is_some() {
                            remainder.complete = true;
                            remainder.refusal = None;
                        }
                        remainder.partial = (!known.is_empty()).then(|| Arc::new(known));
                    }
                    strip_keys(&mut remainder.conditions, |written| {
                        consumed.iter().any(|key| key == written)
                    });
                    // Without the key it took, which the build cannot name: any of them may be
                    // gone, and opening the rest would still say each it holds is there.
                    if unresolved {
                        remainder = EvalResult {
                            refusal: remainder.refusal,
                            ..EvalResult::unknown()
                        };
                    }
                    if remainder.value.is_none() {
                        remainder.complete = false;
                    }
                    self.bind_pattern(&rest.argument, remainder);
                }
            }
            BindingPattern::ArrayPattern(pattern) => {
                for (index, element) in pattern.elements.iter().enumerate() {
                    if let Some(element) = element {
                        self.bind_pattern(element, member_value(value.clone(), &index.to_string()));
                    }
                }
                if let Some(rest) = &pattern.rest {
                    let mut remainder = value;
                    let skipped = pattern.elements.len();
                    remainder.value = match remainder.value {
                        Some(serde_json::Value::Array(array)) => {
                            // What is not known of the elements the rest takes, where they land.
                            remainder.partial = remainder.partial.take().and_then(|known| {
                                let mut rest = Partial::default();
                                known.spread_into(&mut rest, skipped, 0, array.len());
                                (!rest.is_empty()).then(|| Arc::new(rest))
                            });
                            Some(array.into_iter().skip(skipped).collect::<Vec<_>>().into())
                        }
                        _ => None,
                    };
                    if remainder.value.is_none() {
                        remainder.complete = false;
                    }
                    self.bind_pattern(&rest.argument, remainder);
                }
            }
        }
    }

    /// Runs statements in order until one returns.
    ///
    /// `None` is running off the end. `Some` is what the function returns: the value of a
    /// `return`, including a bare `return` — which is `undefined`, not a statement to step past
    /// — or unknown, at the first statement the evaluator cannot run.
    fn execute_statements(&mut self, statements: &'a [Statement<'a>]) -> Option<EvalResult> {
        statements
            .iter()
            .find_map(|statement| self.execute_statement(statement))
    }

    /// One statement. Only what is listed here runs.
    ///
    /// Anything else makes the result unknown rather than being stepped over. Stepping over was
    /// a guess that compiled to the wrong classes with no error: a `switch` or loop that chose or
    /// built the value, a `try`, a `throw` that is reached, and every expression statement, since
    /// what one is for is its effect — an assignment, `Object.assign(out, …)`, a call.
    fn execute_statement(&mut self, statement: &'a Statement<'a>) -> Option<EvalResult> {
        match statement {
            Statement::ReturnStatement(statement) => Some(
                statement
                    .argument
                    .as_ref()
                    .map_or_else(EvalResult::undefined, |value| self.evaluate(value)),
            ),
            Statement::VariableDeclaration(declaration) => {
                // `using` disposes of its value when the block ends, which runs code.
                if declaration.kind.is_using() {
                    return Some(EvalResult::refused(self.statement_refusal(statement)));
                }
                for declarator in &declaration.declarations {
                    let value = declarator
                        .init
                        .as_ref()
                        .map_or_else(EvalResult::undefined, |value| self.evaluate(value));
                    self.bind_pattern(&declarator.id, value);
                }
                None
            }
            Statement::IfStatement(statement) => {
                let test = self.evaluate(&statement.test);
                let Some(truthy) = test.truthiness() else {
                    return Some(EvalResult {
                        refusal: test.refusal,
                        ..EvalResult::unknown()
                    });
                };
                let selected = if truthy {
                    Some(&statement.consequent)
                } else {
                    statement.alternate.as_ref()
                };
                selected.and_then(|selected| self.execute_statement(selected))
            }
            Statement::BlockStatement(block) => self.execute_statements(&block.body),
            // Nothing runs: a function declaration is read where it is called, and a type is
            // erased.
            Statement::EmptyStatement(_)
            | Statement::FunctionDeclaration(_)
            | Statement::TSTypeAliasDeclaration(_)
            | Statement::TSInterfaceDeclaration(_) => None,
            _ => Some(EvalResult::refused(self.statement_refusal(statement))),
        }
    }
}

fn callee_symbol_and_members(
    expression: &Expression<'_>,
    scoping: &Scoping,
) -> Option<(SymbolId, Vec<String>)> {
    match expression {
        Expression::Identifier(identifier) => {
            let reference = identifier.reference_id.get()?;
            Some((scoping.get_reference(reference).symbol_id()?, Vec::new()))
        }
        Expression::StaticMemberExpression(member) => {
            let (symbol, mut members) = callee_symbol_and_members(&member.object, scoping)?;
            members.push(member.property.name.to_string());
            Some((symbol, members))
        }
        Expression::ComputedMemberExpression(member) => {
            let Expression::StringLiteral(property) = &member.expression else {
                return None;
            };
            let (symbol, mut members) = callee_symbol_and_members(&member.object, scoping)?;
            members.push(property.value.to_string());
            Some((symbol, members))
        }
        Expression::ParenthesizedExpression(value) => {
            callee_symbol_and_members(&value.expression, scoping)
        }
        _ => None,
    }
}

fn global_callee_path(expression: &Expression<'_>) -> Option<Vec<String>> {
    match expression {
        Expression::Identifier(identifier) if identifier.reference_id.get().is_some() => {
            Some(vec![identifier.name.to_string()])
        }
        Expression::StaticMemberExpression(member) => {
            let mut path = global_callee_path(&member.object)?;
            path.push(member.property.name.to_string());
            Some(path)
        }
        _ => None,
    }
}

/// Code as a refusal shows it: its first line, without a trailing `;`, shortened past 60
/// characters.
fn excerpt_of(text: &str) -> String {
    let line = text
        .lines()
        .next()
        .unwrap_or_default()
        .trim()
        .trim_end_matches(';');
    if line.chars().count() <= 60 {
        return line.to_string();
    }
    let mut shortened = line.chars().take(59).collect::<String>();
    shortened.push('…');
    shortened
}

/// Whether the reference at `reference` changes the value behind it.
///
/// The reference being written itself is the symbol's write flag. This is the object behind it
/// changing while the binding stays put: a property written, updated or deleted through it at
/// any depth (`theme.text.color = …`), a method that changes it in place (`fonts.push(…)`), or
/// a global that writes into its first argument (`Object.assign(base, …)`).
fn mutates_through(nodes: &AstNodes<'_>, reference: NodeId) -> bool {
    let mut current = reference;
    let mut through_member = false;
    loop {
        let span = nodes.kind(current).span();
        let parent = nodes.parent_id(current);
        if parent == current {
            return false;
        }
        match nodes.kind(parent) {
            AstKind::ParenthesizedExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::TSTypeAssertion(_) => {}
            AstKind::StaticMemberExpression(member) if member.object.span() == span => {
                through_member = true;
            }
            AstKind::ComputedMemberExpression(member) if member.object.span() == span => {
                through_member = true;
            }
            AstKind::PrivateFieldExpression(member) if member.object.span() == span => {
                through_member = true;
            }
            AstKind::AssignmentExpression(assignment) => {
                return through_member && assignment.left.span() == span;
            }
            AstKind::UpdateExpression(_)
            | AstKind::ArrayAssignmentTarget(_)
            | AstKind::AssignmentTargetRest(_) => return through_member,
            AstKind::AssignmentTargetWithDefault(target) => {
                return through_member && target.binding.span() == span;
            }
            AstKind::AssignmentTargetPropertyProperty(property) => {
                return through_member && property.binding.span() == span;
            }
            AstKind::ForInStatement(statement) => {
                return through_member && statement.left.span() == span;
            }
            AstKind::ForOfStatement(statement) => {
                return through_member && statement.left.span() == span;
            }
            AstKind::UnaryExpression(unary) => {
                return through_member && unary.operator == UnaryOperator::Delete;
            }
            AstKind::CallExpression(call) => {
                if call.callee.span() == span {
                    return through_member && is_mutating_method(nodes.kind(current));
                }
                return call
                    .arguments
                    .first()
                    .is_some_and(|argument| argument.span() == span)
                    && global_callee_path(&call.callee)
                        .is_some_and(|path| writes_first_argument(&path));
            }
            _ => return false,
        }
        current = parent;
    }
}

/// The array methods that change an array in place. A style value is JSON, so these are the
/// only methods on it that write.
fn is_mutating_method(callee: AstKind<'_>) -> bool {
    let name = match callee {
        AstKind::StaticMemberExpression(member) => member.property.name.as_str(),
        AstKind::ComputedMemberExpression(member) => match &member.expression {
            Expression::StringLiteral(name) => name.value.as_str(),
            // A method the build cannot name could be any of them.
            _ => return true,
        },
        _ => return false,
    };
    matches!(
        name,
        "push"
            | "pop"
            | "shift"
            | "unshift"
            | "splice"
            | "sort"
            | "reverse"
            | "fill"
            | "copyWithin"
    )
}

/// The globals that write into the object given as their first argument.
fn writes_first_argument(path: &[String]) -> bool {
    match path {
        [object, method] => matches!(
            (object.as_str(), method.as_str()),
            (
                "Object",
                "assign" | "defineProperty" | "defineProperties" | "setPrototypeOf"
            ) | (
                "Reflect",
                "set" | "defineProperty" | "deleteProperty" | "setPrototypeOf"
            )
        ),
        _ => false,
    }
}

/// The outcome of one link of an optional chain.
struct ChainLink {
    result: EvalResult,
    /// An earlier optional link met a nullish receiver, so this link — and every one after it
    /// up to the end of the chain — is skipped rather than evaluated.
    short_circuited: bool,
}

impl ChainLink {
    fn value(result: EvalResult) -> Self {
        Self {
            result,
            short_circuited: false,
        }
    }

    fn short_circuit() -> Self {
        Self {
            result: EvalResult::undefined(),
            short_circuited: true,
        }
    }
}

enum MemberKey<'a> {
    Static(&'a str),
    Computed(&'a Expression<'a>),
}

/// Whether `?.` stops at it: a `null` the build is sure of — a guessed one may be anything — or
/// `undefined`.
fn is_nullish(result: &EvalResult) -> bool {
    match &result.value {
        Some(serde_json::Value::Null) => result.decides(),
        None => result.is_undefined(),
        _ => false,
    }
}

/// What an object could not decide between, as `{ key: value }` fragments, and the keys they are
/// under: a later write of a key replaces them, and looking for them only under a key that has any
/// keeps that from going over every fragment for every property.
#[derive(Default)]
pub(crate) struct Fragments {
    pub(crate) list: Vec<serde_json::Value>,
    keys: HashSet<String>,
}

impl Fragments {
    fn push(&mut self, key: &str, condition: serde_json::Value) {
        self.keys.insert(key.to_string());
        let mut fragment = serde_json::Map::new();
        fragment.insert(key.to_string(), condition);
        self.list.push(fragment.into());
    }

    fn extend(&mut self, conditions: Vec<serde_json::Value>) {
        self.keys.extend(condition_keys(&conditions).cloned());
        self.list.extend(conditions);
    }

    /// Drops what the object could not decide between under `key`.
    fn replace(&mut self, key: &str) {
        if self.keys.remove(key) {
            strip_keys(&mut self.list, |written| written == key);
        }
    }

    /// Drops what the object could not decide between under each of `keys`, going over the
    /// fragments once however many there are: a spread writes every key it holds, and a key at a
    /// time went over every fragment for each.
    fn replace_all<'k>(&mut self, keys: impl IntoIterator<Item = &'k String>) {
        let mut replaced = HashSet::new();
        for key in keys {
            if self.keys.remove(key) {
                replaced.insert(key.as_str());
            }
        }
        if !replaced.is_empty() {
            strip_keys(&mut self.list, |written| replaced.contains(written));
        }
    }
}

/// The keys `stripped` names out of each value an object could not decide between: a `{ key:
/// value }` fragment goes, and a branch of a spread it could not choose, `...(c ? { a, b } :
/// {})`, loses them, as a later write replaces a key in every branch alike.
///
/// A branch emptied so goes too, and with it what it said: that in one branch none of the rest
/// is there. Nothing reads that from the list. A spread it could not choose opens the object,
/// and after one whether a key is there is read off what was written since (`in`).
fn strip_keys(conditions: &mut Vec<serde_json::Value>, stripped: impl Fn(&str) -> bool) {
    conditions.retain_mut(|condition| match condition {
        serde_json::Value::Object(fragment) if fragment.keys().any(|key| stripped(key)) => {
            fragment.retain(|key, _| !stripped(key));
            !fragment.is_empty()
        }
        _ => true,
    });
}

/// What other declarations of an enum add to it — see `FileEvaluator::enum_redeclared`.
#[derive(Default)]
struct EnumMerge {
    /// Members the program has from elsewhere, or a namespace adds, may be there.
    open: bool,
    /// Names a namespace merged with it exports, over a member of the name if it has one.
    written: Vec<String>,
}

/// The names a namespace exports, as one merged with an enum adds them to it, or `None` where one
/// is not named: a destructuring, an export the walk does not know.
fn namespace_exports(namespace: &oxc_ast::ast::TSNamespaceDeclaration<'_>) -> Option<Vec<String>> {
    let block = match &namespace.body {
        // `namespace Tone.Inner { … }` adds `Inner`.
        oxc_ast::ast::TSNamespaceDeclarationBody::TSNamespaceDeclaration(inner) => {
            return Some(vec![inner.id.name.to_string()]);
        }
        oxc_ast::ast::TSNamespaceDeclarationBody::TSModuleBlock(block) => block,
    };
    let mut names = Vec::new();
    for statement in &block.body {
        let declaration = match statement {
            Statement::ExportDeclaration(export) => &export.declaration,
            Statement::ExportNamedDeclaration(export) => {
                names.extend(
                    export
                        .specifiers
                        .iter()
                        .map(|specifier| module_name(&specifier.exported).to_string()),
                );
                continue;
            }
            _ => continue,
        };
        match declaration {
            Declaration::VariableDeclaration(variables) => {
                for declarator in &variables.declarations {
                    names.push(declarator.id.get_binding_identifier()?.name.to_string());
                }
            }
            Declaration::FunctionDeclaration(function) => {
                names.push(function.id.as_ref()?.name.to_string())
            }
            Declaration::ClassDeclaration(class) => names.push(class.id.as_ref()?.name.to_string()),
            Declaration::TSEnumDeclaration(inner) => names.push(inner.id.name.to_string()),
            Declaration::TSNamespaceDeclaration(inner) => names.push(inner.id.name.to_string()),
            Declaration::TSImportEqualsDeclaration(import) => {
                names.push(import.id.name.to_string())
            }
            Declaration::TSTypeAliasDeclaration(_) | Declaration::TSInterfaceDeclaration(_) => {}
            _ => return None,
        }
    }
    Some(names)
}

/// Whether evaluating `expression` runs no code: a literal, or an array or object of them.
fn runs_nothing(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::StringLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_) => true,
        Expression::TemplateLiteral(template) => template.expressions.is_empty(),
        Expression::UnaryExpression(unary) => {
            unary.operator == UnaryOperator::UnaryNegation
                && matches!(
                    unary.argument.get_inner_expression(),
                    Expression::NumericLiteral(_)
                )
        }
        Expression::ArrayExpression(array) => array
            .elements
            .iter()
            .all(|element| element.as_expression().is_some_and(runs_nothing)),
        Expression::ObjectExpression(object) => {
            object.properties.iter().all(|property| match property {
                ObjectPropertyKind::ObjectProperty(property) => {
                    !property.computed && !property.method && runs_nothing(&property.value)
                }
                ObjectPropertyKind::SpreadProperty(_) => false,
            })
        }
        _ => false,
    }
}

/// What is known of an element holding values the build could not decide between, which its array
/// holds under no index of the element's (`conditions`): what its own record says, with each key
/// those values are under not known. Of one not surely an object or an array — a scalar, a guess,
/// an object whose values are alternatives to it rather than to its keys — nothing.
fn undecided_record(value: &EvalResult) -> Option<Arc<Partial>> {
    let surely = value.complete || value.partial.is_some();
    let held = match value.value {
        Some(serde_json::Value::Object(_)) => {
            value.conditions.iter().all(serde_json::Value::is_object)
        }
        // Its elements', which its record says where.
        Some(serde_json::Value::Array(_)) => value.partial.is_some(),
        _ => false,
    };
    if !surely || !held {
        return None;
    }
    let mut record = value.partial.as_deref().cloned().unwrap_or_default();
    for key in condition_keys(&value.conditions) {
        record.write(key, false, None);
    }
    Some(Arc::new(record))
}

/// The keys under the values an object could not decide between: a fragment's, a branch's.
fn condition_keys(conditions: &[serde_json::Value]) -> impl Iterator<Item = &String> {
    conditions
        .iter()
        .filter_map(|condition| match condition {
            serde_json::Value::Object(fragment) => Some(fragment.keys()),
            _ => None,
        })
        .flatten()
}

/// One property written into an object: over what an earlier property or spread wrote under its
/// key, the values that one could not decide between included. Keys keep the order they were
/// first written in, as JavaScript keeps them: `shift_remove`, as `remove` moves the last key
/// into the gap.
pub(crate) fn write_property(
    output: &mut serde_json::Map<String, serde_json::Value>,
    fragments: &mut Fragments,
    partial: &mut Option<Partial>,
    key: String,
    value: EvalResult,
) {
    fragments.replace(&key);
    if value.is_undefined() {
        output.shift_remove(&key);
        partial.get_or_insert_default().write_undefined(&key);
        return;
    }
    // Known only in part inside, as an array with a hole is, or a `null` that may be
    // `undefined`: recorded though the object is complete.
    if !value.complete || value.partial.is_some() || value.nullish {
        partial.get_or_insert_default().write_value(&key, &value);
    } else if let Some(known) = partial {
        known.write(&key, true, None);
    }
    for condition in value.conditions {
        fragments.push(&key, condition);
    }
    // Not known, or one of several values, it leaves nothing of what was there.
    match value.value {
        Some(value) => {
            output.insert(key, value);
        }
        None => {
            output.shift_remove(&key);
        }
    }
}

/// Whether spreading `value` writes no key: `undefined`, `null`, a boolean or a number, decided.
fn writes_nothing(value: &EvalResult) -> bool {
    value.complete
        && value.conditions.is_empty()
        && value.value.as_ref().is_none_or(|value| {
            matches!(
                value,
                serde_json::Value::Null | serde_json::Value::Bool(_) | serde_json::Value::Number(_)
            )
        })
}

/// The keys a spread of `expression` may write, where its source says them all: an object literal
/// with neither a spread nor a key it computes, or a value that writes none — `null`, `undefined`,
/// a boolean, a number — or a choice between them, `c ? { size } : {}`, or `c && { size }`, whose
/// left writes none when it is what the choice gives.
fn spread_keys(expression: &Expression<'_>) -> Option<Vec<String>> {
    match expression.get_inner_expression() {
        Expression::ObjectExpression(object) => object
            .properties
            .iter()
            .map(|property| match property {
                ObjectPropertyKind::ObjectProperty(property) if !property.computed => {
                    property.key.static_name().map(|name| name.into_owned())
                }
                _ => None,
            })
            .collect(),
        Expression::NullLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NumericLiteral(_) => Some(Vec::new()),
        Expression::Identifier(identifier) if identifier.name == "undefined" => Some(Vec::new()),
        Expression::ConditionalExpression(conditional) => {
            let mut keys = spread_keys(&conditional.consequent)?;
            keys.extend(spread_keys(&conditional.alternate)?);
            Some(keys)
        }
        Expression::LogicalExpression(logical) if logical.operator == LogicalOperator::And => {
            spread_keys(&logical.right)
        }
        _ => None,
    }
}

/// A spread of one of several objects whose keys its source says (`spread_keys`): each of `keys`
/// may be written or not, so neither its value nor that it is there is known after it, and every
/// other key is as known as it was — `{ variant: 'solid', ...(c ? { size } : {}) }` holds
/// `variant` whichever it is. What each could be is kept for its rules.
fn spread_keys_written(
    output: &mut serde_json::Map<String, serde_json::Value>,
    fragments: &mut Fragments,
    partial: &mut Option<Partial>,
    keys: &[String],
    conditions: Vec<serde_json::Value>,
) {
    fragments.replace_all(keys);
    output.retain(|key, _| !keys.contains(key));
    let known = partial.get_or_insert_default();
    for key in keys {
        known.forget(key);
    }
    // Open after it, as after any spread whose keys it cannot be sure of, but holding what it
    // held before of every key no branch writes (`Partial::inherit`).
    known.inherit(output.keys().chain(&fragments.keys));
    fragments.extend(
        conditions
            .into_iter()
            .filter(serde_json::Value::is_object)
            .collect(),
    );
}

/// A value spread into an object, or a source of `Object.assign`: its properties written over what
/// was there — its undecided ones and those it wrote as `undefined` too — and what it says of each
/// recorded. One not wholly known may have written anything, so the object is open after it; what
/// it holds of a key it did not know is not kept as the key's value.
pub(crate) fn spread_value(
    output: &mut serde_json::Map<String, serde_json::Value>,
    fragments: &mut Fragments,
    partial: &mut Option<Partial>,
    complete: &mut bool,
    value: EvalResult,
) {
    // `undefined`, `null`, a boolean or a number, decided, writes no key: what the object held is
    // as known as it was. Taken for anything, `{ dense: false, ...o.overrides }` of an option not
    // passed left `dense` a guess.
    if writes_nothing(&value) {
        return;
    }
    let Some(serde_json::Value::Object(values)) = value.value else {
        fragments.extend(value.conditions);
        *complete = false;
        partial.get_or_insert_default().open();
        return;
    };
    let source = value.partial.as_deref();
    // A guess as a whole (`EvalResult::partial`): what it holds it may not, so a key it writes is
    // not known to be there, unless the object surely held it already, which a spread does not
    // remove, whether its value is known or not. Not one an earlier guess, a branch or code it
    // could not follow wrote: after a write it could not attribute to a key, a key is surely there
    // only if written since, or held from before with nothing it could not read written over it
    // since, which would have left it unsettled. One only under a branch may be a spread's it
    // could not choose.
    let held = |key: &String| {
        let holds = output.contains_key(key) || fragments.keys.contains(key);
        match partial.as_ref() {
            None => holds,
            Some(known) if !known.open => {
                holds || known.unsettled.contains(key) || known.undefined.contains(key)
            }
            Some(known) => {
                known.settled.contains(key)
                    || (output.contains_key(key) && !known.unsettled.contains(key))
            }
        }
    };
    let guessed: Vec<String> = if source.is_none() && !value.complete {
        values.keys().filter(|key| !held(key)).cloned().collect()
    } else {
        Vec::new()
    };
    // What it writes: its keys, those under the values it could not decide between, those it
    // could not evaluate and those it wrote as `undefined`.
    let undecided: Vec<String> = condition_keys(&value.conditions).cloned().collect();
    let cleared = source.into_iter().flat_map(|source| &source.undefined);
    let unknown = source.into_iter().flat_map(|source| &source.unsettled);
    fragments.replace_all(
        values
            .keys()
            .chain(&undecided)
            .chain(cleared.clone())
            .chain(unknown.clone()),
    );
    // What was there under a key it holds no value for goes; one it holds a value for keeps its
    // place, as `extend` writes over it there. In one pass: `shift_remove` moves every key after
    // the one it removes.
    let gone: HashSet<&str> = undecided
        .iter()
        .chain(cleared)
        .chain(unknown.clone())
        .filter(|key| !values.contains_key(*key))
        .map(String::as_str)
        .collect();
    if !gone.is_empty() {
        output.retain(|key, _| !gone.contains(key.as_str()));
    }
    fragments.extend(value.conditions);
    if partial.is_some() || source.is_some() || !undecided.is_empty() {
        let known = partial.get_or_insert_default();
        known.write_spread(values.keys().chain(&undecided), source);
        // Written, with a value not known.
        for key in unknown {
            let child = source.and_then(|source| source.children.get(key).cloned());
            known.write(key, false, child);
        }
    }
    output.extend(values);
    // A source not wholly known whose record does not say which keys it did not know — or says
    // a spread of its own may have written any — may have written over anything.
    if source.map_or(!value.complete, |source| source.open) {
        let known = partial.get_or_insert_default();
        known.open();
        for key in &guessed {
            known.write(key, false, None);
        }
    }
}

/// Whether `compactStyles` leaves a style argument out, as it does one that is not an object, or
/// an object holding nothing but `undefined`: known to be one, `null` or `undefined` included.
fn holds_no_style(style: &EvalResult) -> bool {
    if style.nullish || style.is_undefined() {
        return true;
    }
    if !style.complete || !style.conditions.is_empty() {
        return false;
    }
    match &style.value {
        Some(serde_json::Value::Object(object)) => object.is_empty(),
        Some(serde_json::Value::Array(_)) | None => false,
        Some(_) => true,
    }
}

/// Style objects merged, a later key over an earlier one and an object into an object, for what
/// extraction writes rules for: incomplete, as `css.raw`'s own merge may differ. Not an object
/// among them, nothing is known.
fn merged_styles(arguments: Vec<EvalResult>) -> EvalResult {
    fn merge(
        into: &mut serde_json::Map<String, serde_json::Value>,
        from: serde_json::Map<String, serde_json::Value>,
    ) {
        for (key, value) in from {
            match (into.get_mut(&key), value) {
                (Some(serde_json::Value::Object(nested)), serde_json::Value::Object(value)) => {
                    merge(nested, value)
                }
                (_, value) => {
                    into.insert(key, value);
                }
            }
        }
    }
    let mut output = serde_json::Map::new();
    let mut conditions = Vec::new();
    let mut refusal = None;
    for argument in arguments {
        refusal = refusal.or(argument.refusal);
        conditions.extend(argument.conditions);
        match argument.value {
            Some(serde_json::Value::Object(value)) => merge(&mut output, value),
            None if argument.complete => {}
            _ => {
                return EvalResult {
                    refusal,
                    ..EvalResult::unknown()
                };
            }
        }
    }
    EvalResult {
        value: Some(output.into()),
        conditions,
        complete: false,
        refusal,
        partial: None,
        nullish: false,
    }
}

/// What a helper is given of `arguments`, which it takes by position: those before the first
/// spread of unknown length, and in its place a marker that no argument from there on is placed
/// (`EvalResult::unplaced`), so each parameter there is not known, however far past it.
fn positional(
    mut arguments: Vec<EvalResult>,
    from: Option<(usize, Option<Arc<Refusal>>)>,
) -> Vec<EvalResult> {
    if let Some((at, refusal)) = from {
        arguments.truncate(at);
        arguments.push(EvalResult::unplaced(refusal));
    }
    arguments
}

/// What a spread of `value` passes a call, where how many it passes is known: an array known
/// element by element, or one whose record says where each element is, each as the record has
/// it. Otherwise how many is not known, and the refusal, if any, says why.
fn spread_arguments(value: EvalResult) -> Result<Vec<EvalResult>, Option<Arc<Refusal>>> {
    let counted = !value.is_undecided()
        && !value.nullish
        && value
            .partial
            .as_deref()
            .map_or(value.complete, |record| !record.open);
    let Some(serde_json::Value::Array(items)) = value.value.filter(|_| counted) else {
        return Err(value.refusal);
    };
    let Some(record) = value.partial else {
        return Ok(items.into_iter().map(EvalResult::known).collect());
    };
    let refusal = value.refusal;
    Ok(items
        .into_iter()
        .enumerate()
        .map(|(index, item)| {
            let key = index.to_string();
            if let Some(child) = record.children.get(&key) {
                // An object known only in part: what is known of it, with its record.
                return EvalResult {
                    value: Some(item),
                    partial: Some(child.clone()),
                    refusal: refusal.clone(),
                    ..EvalResult::unknown()
                };
            }
            if record.nullish.contains(&key) {
                // A hole, or `undefined`, held as `null`.
                return EvalResult {
                    nullish: true,
                    ..EvalResult::known(item)
                };
            }
            if record.knows(&key) {
                EvalResult::known(item)
            } else {
                EvalResult {
                    refusal: refusal.clone(),
                    ..EvalResult::unknown()
                }
            }
        })
        .collect())
}

/// The array index a property name is, as JavaScript reads one: the canonical decimal form of an
/// integer, so `'1'` is an index and `'01'` and `'+1'` are property names no array has.
fn array_index(property: &str) -> Option<usize> {
    let canonical = !property.is_empty()
        && property.bytes().all(|byte| byte.is_ascii_digit())
        && (property == "0" || !property.starts_with('0'));
    canonical.then(|| property.parse().ok()).flatten()
}

fn member_value(mut result: EvalResult, property: &str) -> EvalResult {
    // A property of `null` or `undefined` throws.
    if result.nullish {
        return EvalResult {
            refusal: result.refusal,
            ..EvalResult::unknown()
        };
    }
    let object_was_known = result.value.is_some();
    let partial = result.partial.take();
    let is_array = matches!(result.value, Some(serde_json::Value::Array(_)));
    // An element the build could not evaluate is held as `null` in its place; it is not known at
    // all, nullish or not.
    let placeholder = is_array
        && partial
            .as_deref()
            .is_some_and(|partial| partial.unsettled.contains(property));
    // Only while the property is known: after a spread that may have written over it, what the
    // object said of it no longer holds.
    let known = partial
        .as_deref()
        .is_none_or(|partial| partial.knows(property));
    result.nullish = known
        && partial
            .as_deref()
            .is_some_and(|partial| partial.nullish.contains(property));
    // An object's undecided values are recorded per property, as `{ property: value }`
    // fragments, so a read of one property keeps its own and none of its siblings'. `theme.w`
    // beside `px: dense ? '2' : '4'` used to carry `px`'s choices along: their rules were
    // emitted, and the read was undecided although `w` is not.
    //
    // An array holds its elements' fragments under no index of theirs, so one it holds under the
    // index read is a fragment some element holds under a key that is that index — that element's,
    // or a sibling's: `[{ k: 1 }, { 0: { z: c ? 1 : 2 } }][0]` kept `z`'s choices. Such a read is
    // not known, and keeps them only for the rules they may be.
    let mut misattributable = false;
    // Whether any of its conditions are its own: what a fragment held under `property`.
    let mut own = false;
    if result.conditions.iter().any(serde_json::Value::is_object) {
        result.conditions = std::mem::take(&mut result.conditions)
            .into_iter()
            .filter_map(|condition| match condition {
                serde_json::Value::Object(mut fragment) => {
                    let kept = fragment.shift_remove(property);
                    own |= kept.is_some();
                    misattributable |= is_array && kept.is_some();
                    kept
                }
                other => Some(other),
            })
            .collect();
    }
    if let Some(partial) = partial {
        result.complete = known;
        // Kept though the property is not wholly known: it says which of its own are. A spread
        // that may have written over it drops what it said (`Partial::open`).
        result.partial = partial.children.get(property).cloned();
        // The reason belongs to a sibling the read does not reach.
        if result.complete {
            result.refusal = None;
        }
    }
    // What the receiver holds under `property`, and whether, holding nothing, it is known to have
    // nothing there: a missing property on a known object is JavaScript's known `undefined`, but
    // one its prototype has — `toString`, an array's `map` — is not, and is not guessed.
    let (value, absent) = match result.value {
        Some(serde_json::Value::Object(object)) => match object.get(property) {
            Some(value) => (Some(value.clone()), false),
            None => (None, !OBJECT_PROTOTYPE.contains(&property)),
        },
        Some(serde_json::Value::Array(array)) if property == "length" => {
            (Some(array.len().into()), false)
        }
        // A hole is held as `null`, and the array's `partial` says it is not known.
        Some(serde_json::Value::Array(array)) => match array_index(property) {
            Some(index) => (array.get(index).cloned(), true),
            None => (None, !may_be_inherited(property)),
        },
        // A literal's whitespace is collapsed as it is read, so a space may have been any run of
        // it: the length is not known, nor anything from the first space on.
        Some(serde_json::Value::String(value)) if property == "length" => {
            if value.contains(' ') {
                (None, false)
            } else {
                (Some(value.encode_utf16().count().into()), false)
            }
        }
        // A string's index reads its UTF-16 code unit; half a surrogate pair has no `String`.
        Some(serde_json::Value::String(value)) => match array_index(property) {
            Some(index) => {
                // Past its end it is `undefined`, unless a space came first: a length not known.
                let mut read = (None, true);
                for (position, unit) in value.encode_utf16().enumerate() {
                    if unit == 0x20 {
                        read = (None, false);
                        break;
                    }
                    if position == index {
                        let character = char::from_u32(u32::from(unit));
                        read = (
                            character.map(|character| character.to_string().into()),
                            false,
                        );
                        break;
                    }
                }
                read
            }
            None => (None, !may_be_inherited(property)),
        },
        _ => (None, false),
    };
    result.value = value.filter(|value| !(placeholder && value.is_null()));
    if result.value.is_none() && !(absent && object_was_known) {
        result.complete = false;
    }
    // Surely not there, it is `undefined`, whatever its siblings could be: carried along, their
    // choices made it one of several, so `xs[2]` past the end of `[c ? '1' : '2', '4']` was no
    // `undefined` to a default.
    if result.value.is_none() && result.complete && !own {
        result.conditions.clear();
    }
    // What may be `null` or `undefined` is held as `null`, as every other such value is.
    if result.nullish && result.value.is_none() {
        result.value = Some(serde_json::Value::Null);
    }
    if misattributable {
        result.complete = false;
        result.partial = None;
    }
    result
}

/// What every object has from `Object.prototype`, so a read or an `in` of one is not a missing
/// property's `undefined` or `false`.
const OBJECT_PROTOTYPE: &[&str] = &[
    "constructor",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "toString",
    "valueOf",
    "__proto__",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
];

/// Whether an array or a string may have `property` from its prototype. Every name one has there is
/// an identifier, so `'01'` and `'-1'` are known to be missing, and `map` is not.
fn may_be_inherited(property: &str) -> bool {
    property
        .chars()
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_' || first == '$')
}

/// A computed key's value, unless it is a `null` that may be `undefined`, whose name is not known.
fn known_key(key: EvalResult) -> Option<serde_json::Value> {
    // Converted to a string as any key is: not where any of it is not known — `parts.join('-')`
    // of an undecided part picked a property as if it were the one.
    if key.nullish || !key.converts() {
        None
    } else {
        key.value
    }
}

fn module_name<'a>(name: &'a ModuleExportName<'a>) -> &'a str {
    name.name().as_str()
}

pub(crate) fn normalize_path(path: &str) -> String {
    let path = PathBuf::from(path);
    let mut output = PathBuf::new();
    for component in path.components() {
        use std::path::Component;
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                output.pop();
            }
            other => output.push(other.as_os_str()),
        }
    }
    output.to_string_lossy().replace('\\', "/")
}

/// How a module's text is parsed.
///
/// JavaScript modules accept JSX, as a bundler's `.js` component files do. A `parser:before`
/// hook can turn a framework single-file component into TSX while keeping its logical filename,
/// so an unknown extension reads as TSX. `.ts`/`.mts`/`.cts` keep TypeScript's own rule: no JSX,
/// so `<T>value` is a cast.
pub(crate) fn source_type_for(filename: &str) -> SourceType {
    match SourceType::from_path(filename) {
        Ok(source_type) if source_type.is_javascript() => source_type.with_jsx(true),
        Ok(source_type) => source_type,
        Err(_) => SourceType::tsx(),
    }
}

fn collect_package_targets(value: &serde_json::Value, output: &mut Vec<String>) {
    match value {
        serde_json::Value::String(value) => output.push(value.clone()),
        serde_json::Value::Array(values) => {
            for value in values {
                collect_package_targets(value, output);
            }
        }
        serde_json::Value::Object(values) => {
            // TypeScript's bundler resolution prefers the import/default branches. Preserve
            // declaration order for other condition sets rather than executing package code.
            for condition in ["import", "default", "types"] {
                if let Some(value) = values.get(condition) {
                    collect_package_targets(value, output);
                    return;
                }
            }
            if let Some(value) = values.values().next() {
                collect_package_targets(value, output);
            }
        }
        _ => {}
    }
}

fn path_mapping_priority(pattern: &str) -> (bool, usize, usize) {
    let Some(star) = pattern.find('*') else {
        return (true, pattern.len(), 0);
    };
    (false, star, pattern.len() - star - 1)
}

fn package_mapping<'map, 'specifier>(
    mappings: &'map serde_json::Map<String, serde_json::Value>,
    specifier: &'specifier str,
) -> Option<(&'map serde_json::Value, &'specifier str)> {
    if let Some(value) = mappings.get(specifier) {
        return Some((value, ""));
    }
    mappings
        .iter()
        .filter_map(|(pattern, value)| {
            wildcard_match(pattern, specifier).map(|capture| (pattern, value, capture))
        })
        .max_by_key(|(pattern, _, _)| path_mapping_priority(pattern))
        .map(|(_, value, capture)| (value, capture))
}

fn wildcard_match<'a>(pattern: &str, specifier: &'a str) -> Option<&'a str> {
    let Some(star) = pattern.find('*') else {
        return (pattern == specifier).then_some("");
    };
    let (head, tail_with_star) = pattern.split_at(star);
    let tail = &tail_with_star[1..];
    specifier.strip_prefix(head)?.strip_suffix(tail)
}

fn path_candidates(base: &Path) -> Vec<PathBuf> {
    const EXTENSIONS: &[&str] = &["ts", "tsx", "d.ts", "mts", "cts", "js", "jsx", "mjs", "cjs"];
    let mut output = vec![base.to_path_buf()];
    let text = base.to_string_lossy();
    let emitted = [
        (".js", &[".ts", ".tsx", ".d.ts", ".js", ".jsx"][..]),
        (".mjs", &[".mts", ".d.mts", ".mjs"][..]),
        (".cjs", &[".cts", ".d.cts", ".cjs"][..]),
    ];
    if let Some((suffix, replacements)) = emitted.iter().find(|(suffix, _)| text.ends_with(suffix))
    {
        output.clear();
        for replacement in *replacements {
            output.push(PathBuf::from(format!(
                "{}{}",
                &text[..text.len() - suffix.len()],
                replacement
            )));
        }
    } else if base.extension().is_none() {
        for extension in EXTENSIONS {
            output.push(PathBuf::from(format!("{text}.{extension}")));
        }
        for extension in EXTENSIONS {
            output.push(base.join(format!("index.{extension}")));
        }
    }
    output
}

fn is_javascript_whitespace(character: char) -> bool {
    matches!(character, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

fn normalize_whitespace(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    output.extend(collapsed(value));
    output
}

/// `value` with each run of whitespace one space, as a literal is read.
fn collapsed(value: &str) -> impl Iterator<Item = char> + '_ {
    let mut whitespace = false;
    value.chars().filter_map(move |character| {
        let space = is_javascript_whitespace(character);
        let first = space && !whitespace;
        whitespace = space;
        if space {
            first.then_some(' ')
        } else {
            Some(character)
        }
    })
}

/// An element as `Array.prototype.join` writes it: a `null` or `undefined` one — and a hole, which
/// the array evaluator holds as `null` — as nothing. `[1, , 2].join('-')` is `1--2`.
fn joined(value: &serde_json::Value) -> String {
    if value.is_null() {
        String::new()
    } else {
        to_js_string(value)
    }
}

fn truthy(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => false,
        serde_json::Value::Bool(value) => *value,
        serde_json::Value::Number(value) => value
            .as_f64()
            .is_some_and(|value| value != 0.0 && !value.is_nan()),
        serde_json::Value::String(value) => !value.is_empty(),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => true,
    }
}

fn to_js_string(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(value) => value.to_string(),
        serde_json::Value::Number(value) => js_number_string(value.as_f64().unwrap_or(f64::NAN)),
        serde_json::Value::String(value) => value.clone(),
        serde_json::Value::Array(values) => values.iter().map(joined).collect::<Vec<_>>().join(","),
        serde_json::Value::Object(_) => "[object Object]".to_string(),
    }
}

/// A number as JavaScript's `String(number)` writes it: the shortest digits that read back as the
/// same number, plainly from 1e-6 up to 1e21 and with an exponent outside that, and `-0` as `0`.
///
/// Rust's own formatting agrees on the digits but not on where the exponent starts, so `1e21`
/// came out as twenty-two digits and `0.000001` as `1e-6`.
fn js_number_string(number: f64) -> String {
    if number.is_nan() {
        return "NaN".to_string();
    }
    if number == 0.0 {
        return "0".to_string();
    }
    if number.is_infinite() {
        return if number > 0.0 {
            "Infinity"
        } else {
            "-Infinity"
        }
        .to_string();
    }
    // An integer below 2^53 is its own shortest form. Past it the shortest digits are fewer
    // than the exact ones, and JavaScript pads them with zeros: `2 ** 60` is
    // `1152921504606847000`.
    if number.fract() == 0.0 && number.abs() < 9_007_199_254_740_992.0 {
        return (number as i64).to_string();
    }
    if number < 0.0 {
        return format!("-{}", js_number_string(-number));
    }
    // The shortest digits that round-trip, as `d.ddde±x`.
    let scientific = format!("{number:e}");
    let (mantissa, exponent) = scientific.split_once('e').unwrap_or((&scientific, "0"));
    let digits = mantissa.replace('.', "");
    let count = digits.len() as i32;
    // The power of ten the first digit sits after: `n` in ECMAScript's Number::toString.
    let point = exponent.parse::<i32>().unwrap_or(0) + 1;
    if count <= point && point <= 21 {
        digits + &"0".repeat((point - count) as usize)
    } else if 0 < point && point <= 21 {
        format!(
            "{}.{}",
            &digits[..point as usize],
            &digits[point as usize..]
        )
    } else if -6 < point && point <= 0 {
        format!("0.{}{digits}", "0".repeat(point.unsigned_abs() as usize))
    } else {
        let sign = if point > 0 { '+' } else { '-' };
        let exponent = (point - 1).unsigned_abs();
        match digits.split_at(1) {
            (first, "") => format!("{first}e{sign}{exponent}"),
            (first, rest) => format!("{first}.{rest}e{sign}{exponent}"),
        }
    }
}

/// The number an operand converts to, where the build can say for sure.
///
/// A string converts as JavaScript's `Number` reads it, where the two parsers agree: trimmed of
/// JavaScript's whitespace — Rust's `trim` also strips U+0085, which JavaScript keeps — and only
/// to a finite number, as Rust also reads `inf` and `infinity`. What only JavaScript reads, an
/// empty string or `0x10`, is left unknown.
fn number_value(value: &serde_json::Value) -> Option<f64> {
    match value {
        serde_json::Value::Null => Some(0.0),
        serde_json::Value::Bool(value) => Some(if *value { 1.0 } else { 0.0 }),
        serde_json::Value::Number(value) => value.as_f64(),
        serde_json::Value::String(value) => value
            .trim_matches(is_javascript_whitespace)
            .parse::<f64>()
            .ok()
            .filter(|number| number.is_finite()),
        _ => None,
    }
}

/// `ToInt32`: the number truncated and wrapped into 32 bits, as a bitwise operator takes it.
/// Rust's `as i32` saturates instead, so `2 ** 32 | 0` was `2147483647` rather than `0`.
fn to_int32(number: f64) -> i32 {
    if !number.is_finite() {
        return 0;
    }
    number.trunc().rem_euclid(4_294_967_296.0) as u32 as i32
}

/// `+` as JavaScript evaluates it: concatenation once either side is a string — or an array or
/// object, which convert to one — and numeric addition otherwise.
///
/// It used to concatenate unconditionally, after the retired extractor, so `base + 1` with
/// `base = 10` compiled to `z_101` while the same expression at runtime is `11`. The class and
/// its rule agreed with each other, which is why nothing caught it; both disagreed with the
/// source.
///
/// A `null` here is JavaScript's `null`: an array element held as one, which may be a hole or
/// `undefined`, is not read as a value (`member_value`).
fn add_values(left: &serde_json::Value, right: &serde_json::Value) -> Option<serde_json::Value> {
    let converts_to_string = |value: &serde_json::Value| {
        matches!(
            value,
            serde_json::Value::String(_)
                | serde_json::Value::Array(_)
                | serde_json::Value::Object(_)
        )
    };
    if converts_to_string(left) || converts_to_string(right) {
        return Some(serde_json::Value::String(format!(
            "{}{}",
            to_js_string(left),
            to_js_string(right)
        )));
    }
    numeric_binary(left, right, |a, b| a + b)
}

fn numeric_binary(
    left: &serde_json::Value,
    right: &serde_json::Value,
    operation: impl FnOnce(f64, f64) -> f64,
) -> Option<serde_json::Value> {
    serde_json::Number::from_f64(operation(number_value(left)?, number_value(right)?))
        .map(Into::into)
}
fn integer_binary(
    left: &serde_json::Value,
    right: &serde_json::Value,
    operation: impl FnOnce(i32, i32) -> serde_json::Value,
) -> Option<serde_json::Value> {
    Some(operation(
        to_int32(number_value(left)?),
        to_int32(number_value(right)?),
    ))
}

/// A shift takes its count modulo 32, as JavaScript does; Rust panics past 31 in a debug build.
fn shift_count(count: i32) -> u32 {
    count as u32 & 31
}
/// `===` as JavaScript answers it, where the build can: two objects or arrays are the same only as
/// one object, which nothing here says, and two numbers are compared as numbers, however each is
/// held. Values of two types are never the same.
///
/// A literal's whitespace is collapsed as it is read, while a string built from others keeps what
/// each held, so two strings are compared with each run of it one space: different so, they differ
/// at runtime too, but the same, they are known to be the same only holding none. Any space made
/// them unknown, so `value === 'none'` given `'1px solid'` was not decided.
fn strict_equals(left: &serde_json::Value, right: &serde_json::Value) -> Option<bool> {
    use serde_json::Value;
    match (left, right) {
        (Value::Object(_) | Value::Array(_), Value::Object(_) | Value::Array(_)) => None,
        (Value::String(a), Value::String(b)) => {
            if !collapsed(a).eq(collapsed(b)) {
                Some(false)
            } else if a.contains(is_javascript_whitespace) {
                None
            } else {
                Some(true)
            }
        }
        (Value::Number(a), Value::Number(b)) => Some(a.as_f64() == b.as_f64()),
        _ => Some(left == right),
    }
}

/// `==`: as `===` for two values of one type, and otherwise each converted as JavaScript converts
/// it — a boolean to a number, a string beside a number to one, an object or array beside anything
/// else to the string it converts to. It compared JSON, so `'0' == 0` was false.
fn loose_equals(left: &serde_json::Value, right: &serde_json::Value) -> Option<bool> {
    use serde_json::Value;
    match (left, right) {
        (Value::Null, Value::Null) => Some(true),
        (Value::Null, _) | (_, Value::Null) => Some(false),
        (Value::Object(_) | Value::Array(_), Value::Object(_) | Value::Array(_)) => None,
        (Value::Object(_) | Value::Array(_), other)
        | (other, Value::Object(_) | Value::Array(_)) => {
            let structured = if matches!(left, Value::Object(_) | Value::Array(_)) {
                left
            } else {
                right
            };
            loose_equals(&Value::String(to_js_string(structured)), other)
        }
        (Value::Bool(_), _) | (_, Value::Bool(_))
            if std::mem::discriminant(left) != std::mem::discriminant(right) =>
        {
            let number = |value: &Value| {
                serde_json::Number::from_f64(number_value(value)?).map(Value::Number)
            };
            loose_equals(&number(left)?, &number(right)?)
        }
        // A run of whitespace collapsed to one space converts as the run does: trimmed at either
        // end, and no number inside.
        (Value::Number(_), Value::String(_)) | (Value::String(_), Value::Number(_)) => {
            Some(number_value(left)? == number_value(right)?)
        }
        _ => strict_equals(left, right),
    }
}

/// A relational comparison: two strings by their UTF-16 code units, as JavaScript compares them,
/// and anything else as numbers. `'10' < '9'` is true.
fn compare_binary(
    left: &serde_json::Value,
    right: &serde_json::Value,
    operation: impl FnOnce(f64, f64) -> bool,
) -> Option<serde_json::Value> {
    if let (serde_json::Value::String(left), serde_json::Value::String(right)) = (left, right) {
        // A string literal's whitespace is collapsed to one space as it is read, so a space may
        // have been a tab, an NBSP or a run of them, which order differently.
        if left.contains(' ') || right.contains(' ') {
            return None;
        }
        let order = left.encode_utf16().cmp(right.encode_utf16()) as i8;
        return Some(operation(f64::from(order), 0.0).into());
    }
    Some(operation(number_value(left)?, number_value(right)?).into())
}

// Keep the N-API option types used in this module live under strict dead-code linting even
// when a platform build strips one branch of module resolution.
const _: fn(&NativePathMapping, &NativeToken) = |_, _| {};
