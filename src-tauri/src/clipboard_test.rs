use std::path::Path;

use crate::clipboard::{encode_path, file_uri};

#[test]
fn keeps_unreserved_characters_and_separators() {
    assert_eq!(encode_path("/tmp/A-b_c.d~e/f"), "/tmp/A-b_c.d~e/f");
}

#[test]
fn percent_encodes_spaces_and_uri_delimiters() {
    assert_eq!(
        encode_path("/tmp/My Docs/a #1?.md"),
        "/tmp/My%20Docs/a%20%231%3F.md"
    );
}

#[test]
fn percent_encodes_non_ascii_bytes_as_utf8() {
    assert_eq!(encode_path("/tmp/ü.md"), "/tmp/%C3%BC.md");
}

#[cfg(unix)]
#[test]
fn builds_a_file_uri_from_an_absolute_path() {
    assert_eq!(
        file_uri(Path::new("/home/marc/notes.md")),
        "file:///home/marc/notes.md"
    );
}

#[cfg(unix)]
#[test]
fn encodes_special_characters_in_the_file_uri() {
    assert_eq!(
        file_uri(Path::new("/tmp/my notes.md")),
        "file:///tmp/my%20notes.md"
    );
}
