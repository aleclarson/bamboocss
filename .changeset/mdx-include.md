---
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

An `.mdx` file in `include` reaches the stylesheet, and its `css()` calls are compiled.

- A document reached the parser as it was, and Markdown is not TSX: the first apostrophe in its prose failed the file,
  and every style in it left the stylesheet. One that parsed anyway — JSX and nothing else — had the `css()` in a code
  example read as a call, when to MDX it is a string.
- What MDX runs is now read, where it stands: imports and exports, each JSX tag and `{expression}`. Prose, code blocks,
  inline code, link definitions and frontmatter are not, and nor is math that holds LaTeX, as `remark-math` reads it. An
  import among an element's children, which MDX hoists, binds as it does there, and a tag or an expression running
  across a blockquote's lines is read without the blockquote's `>`. Over 852 real documents it keeps exactly the
  characters MDX's own tokenizer reads as code.
- The Vite compiler took no `.mdx` module, so a page kept its `css()` calls, which throw when they run. It now compiles
  the module MDX's plugin produces, as it compiles a Vue or Svelte component's.
- A project that converts its MDX in a `parser:before` hook of its own keeps it: the built-in conversion runs after, and
  only on a file nothing before it rewrote.
- Reading a file that is not MDX costs ~27 ns more for the extra hook (95–97 → 122–126 ns per file); a document is
  converted at ~62 MB/s.
