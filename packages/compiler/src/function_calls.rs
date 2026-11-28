use serde::Serialize;
use typst::syntax::{ast, parse, LinkedNode, SyntaxKind};

#[derive(Serialize)]
pub(crate) struct FunctionCallRange {
    start: usize,
    end: usize,
}

pub(crate) fn find_function_calls(
    source: &str,
    name: &str,
) -> Result<Vec<FunctionCallRange>, &'static str> {
    let root = parse(source);
    if root.diagnosis().errors {
        return Err("Invalid Typst syntax");
    }

    let mut pending = vec![LinkedNode::new(&root)];
    let mut ranges = Vec::new();
    while let Some(node) = pending.pop() {
        if let Some(call) = node.get().cast::<ast::FuncCall>() {
            if matches!(call.callee(), ast::Expr::Ident(ident) if ident.get().as_str() == name)
            {
                let mut range = node.range();
                if range.start > 0 && source.as_bytes()[range.start - 1] == b'#' {
                    range.start -= 1;
                }
                ranges.push(range);
            }
        }
        pending.extend(node.children().rev());
    }
    ranges.sort_by_key(|range| range.start);
    let mut byte_offset = 0;
    let mut utf16_offset = 0;
    Ok(ranges
        .into_iter()
        .map(|range| {
            utf16_offset += source[byte_offset..range.start].encode_utf16().count();
            byte_offset = range.start;
            FunctionCallRange {
                start: utf16_offset,
                end: utf16_offset + source[range].encode_utf16().count(),
            }
        })
        .collect())
}

pub(crate) fn is_safe_math(source: &str, inline_only: bool) -> bool {
    let root = parse(source);
    if root.diagnosis().errors {
        return false;
    }
    let mut children = root.children();
    let Some(equation) = children.next().and_then(|node| node.cast::<ast::Equation>()) else {
        return false;
    };
    if children.next().is_some() || (inline_only && equation.block()) {
        return false;
    }
    let mut pending = vec![&root];
    while let Some(node) = pending.pop() {
        if node.kind() == SyntaxKind::Hash
            || (node.kind() == SyntaxKind::MathIdent && node.leaf_text() == "std")
        {
            return false;
        }
        pending.extend(node.children());
    }
    true
}

#[cfg(test)]
mod tests {
    use super::is_safe_math;

    #[test]
    fn validates_one_non_scripting_equation() {
        for source in [
            "$x^2$",
            "$ integral_0^1 x dif x $",
            "$ x\n\n + y $",
            "$ x\n\n```\nx\n```\n y $",
            r#"$mat(delim: "[", a, b; c, d)$"#,
            r#"$arrow.r.long + \#$"#,
        ] {
            assert!(is_safe_math(source, false), "{source}");
        }
        for source in [
            "$x^$",
            r#"$#read("secret")$"#,
            r#"$std.read("secret")$"#,
            r#"$#import "@preview/pkg:1.0.0": *$"#,
            r#"$x$ #read("secret")"#,
        ] {
            assert!(!is_safe_math(source, false), "{source}");
        }
        assert!(is_safe_math("$x^2$", true));
        assert!(!is_safe_math("$ x^2 $", true));
    }
}
