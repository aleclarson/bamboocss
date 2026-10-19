//! Names built from a value's content: `keyframes({ … })` is named for its stops.
//!
//! Computed here and nowhere else, so the name the evaluator folds into a style object and the
//! name the stylesheet writes on the `@keyframes` block cannot drift apart. The hash is the
//! generated runtime's `toHash` over the stops' `JSON.stringify`, so a name can be checked from
//! JavaScript.

use std::fmt::Write;

use crate::evaluator::js_number_string;

/// `JSON.stringify` of a string. A Rust string holds no lone surrogate, the one case the two
/// would write differently.
fn json_string(value: &str, out: &mut String) {
    out.push('"');
    for character in value.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0C}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            control if (control as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", control as u32);
            }
            other => out.push(other),
        }
    }
    out.push('"');
}

/// `JSON.stringify` of a value, keys in the order they were written.
///
/// Not sorted, though sorting would let `{ from, to }` and `{ to, from }` share a block: a stop
/// can be written twice, as `from` and `0%`, and then the later of the two wins where they
/// overlap. One name for both orders would leave which of them the stylesheet writes to
/// whichever file was read first.
pub(crate) fn json_stringify(value: &serde_json::Value) -> String {
    let mut out = String::new();
    write_json(value, &mut out);
    out
}

fn write_json(value: &serde_json::Value, out: &mut String) {
    match value {
        serde_json::Value::Null => out.push_str("null"),
        serde_json::Value::Bool(flag) => out.push_str(if *flag { "true" } else { "false" }),
        serde_json::Value::Number(number) => match number.as_f64() {
            Some(number) if number.is_finite() => out.push_str(&js_number_string(number)),
            _ => out.push_str("null"),
        },
        serde_json::Value::String(text) => json_string(text, out),
        serde_json::Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_json(item, out);
            }
            out.push(']');
        }
        serde_json::Value::Object(map) => {
            out.push('{');
            for (index, (key, item)) in map.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                json_string(key, out);
                out.push(':');
                write_json(item, out);
            }
            out.push('}');
        }
    }
}

fn hash_char(code: u32) -> char {
    char::from_u32(code + if code > 25 { 39 } else { 97 }).unwrap_or('a')
}

/// The runtime's `toHash`: a djb2 over the UTF-16 code units, last first, in 32-bit
/// arithmetic as JavaScript's `^` does it, written in base 52.
pub(crate) fn to_hash(value: &str) -> String {
    let units: Vec<u16> = value.encode_utf16().collect();
    let mut hash: i32 = 5381;
    for unit in units.iter().rev() {
        hash = hash.wrapping_mul(33) ^ i32::from(*unit);
    }
    let mut code = hash as u32;
    let mut name = Vec::new();
    while code > 52 {
        name.push(hash_char(code % 52));
        code /= 52;
    }
    name.push(hash_char(code % 52));
    name.into_iter().rev().collect()
}

/// The name `keyframes(stops)` returns: `kf_` and the hash of the stops, after the class
/// prefix where one is set.
///
/// Of the stops without their nullish properties, which is what a call's data holds and so what
/// the block is written from. The evaluator reaches here holding them, folding the call where a
/// style object reads it, and naming the two apart would point that style at no block.
pub(crate) fn keyframes_name(stops: &serde_json::Value, prefix: Option<&str>) -> String {
    let mut stops = stops.clone();
    crate::drop_nullish_properties(&mut stops);
    let base = format!("kf_{}", to_hash(&json_stringify(&stops)));
    match prefix {
        Some(prefix) if !prefix.is_empty() => format!("{prefix}-{base}"),
        _ => base,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // The runtime's `toHash(JSON.stringify(stops))` for the same stops.
    #[test]
    fn names_stops_as_the_runtime_hash_does() {
        assert_eq!(
            keyframes_name(
                &json!({ "from": { "opacity": 0 }, "to": { "opacity": 1 } }),
                None
            ),
            "kf_feVUdh"
        );
        assert_eq!(
            keyframes_name(&json!({ "to": { "transform": "rotate(360deg)" } }), None),
            "kf_fcamfv"
        );
        assert_eq!(
            keyframes_name(
                &json!({ "from": { "transform": "scale(1)" }, "to": { "transform": "scale(1.2)" } }),
                None
            ),
            "kf_jkSwUM"
        );
        assert_eq!(
            keyframes_name(&json!({ "from": { "opacity": 0 } }), None),
            "kf_gdwKNo"
        );
        assert_eq!(
            keyframes_name(
                &json!({ "0%": { "opacity": 0.5 }, "100%": { "opacity": 1e21 } }),
                None
            ),
            "kf_faOzTf"
        );
    }

    #[test]
    fn names_stops_by_the_order_they_were_written_in() {
        assert_eq!(
            keyframes_name(
                &json!({ "to": { "opacity": 1 }, "from": { "opacity": 0 } }),
                None
            ),
            "kf_bFzusB"
        );
    }

    #[test]
    fn names_stops_without_their_nullish_properties() {
        assert_eq!(
            keyframes_name(
                &json!({ "from": { "opacity": 0, "color": null }, "to": { "opacity": 1 } }),
                None
            ),
            "kf_feVUdh"
        );
    }

    #[test]
    fn puts_the_class_prefix_first() {
        let stops = json!({ "from": { "opacity": 0 }, "to": { "opacity": 1 } });
        assert_eq!(keyframes_name(&stops, Some("app")), "app-kf_feVUdh");
        assert_eq!(keyframes_name(&stops, Some("")), "kf_feVUdh");
    }

    #[test]
    fn serializes_numbers_and_strings_as_javascript_does() {
        assert_eq!(json_stringify(&json!(0.5)), "0.5");
        assert_eq!(json_stringify(&json!(1e21)), "1e+21");
        assert_eq!(json_stringify(&json!(-0.0)), "0");
        assert_eq!(
            json_stringify(&json!("a\"b\\c\n\u{1}é")),
            "\"a\\\"b\\\\c\\n\\u0001é\""
        );
        assert_eq!(json_stringify(&json!([1, null, true])), "[1,null,true]");
    }
}
