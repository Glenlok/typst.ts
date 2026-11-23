use serde::Serialize;
use typst::syntax::{ast, parse, LinkedNode};

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
