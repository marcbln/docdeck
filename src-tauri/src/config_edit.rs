//! Surgical, atomic editing of the watch configuration file.
//!
//! Only the `watch` and `exclude` arrays are rewritten; comments, formatting,
//! `[tray]` and unknown keys survive because the document is edited with
//! `toml_edit` instead of being re-serialized from `WatchConfig`.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use globset::GlobBuilder;
use toml_edit::{Array, DocumentMut, Item, Value};

use crate::commands::{FieldError, WatchConfigView};
use crate::config::{self, Platform};
use crate::paths::normalize_selector;

/// A validated request from the in-app surface.
#[derive(Debug, Clone)]
pub struct SaveRequest {
    pub watch: Vec<String>,
    pub exclude: Vec<String>,
    pub expected_revision: String,
    pub create_from_example: bool,
}

/// Why a save did not write the file.
#[derive(Debug)]
pub enum SaveFailure {
    /// The file changed since the surface read it; nothing was written.
    Conflict(WatchConfigView),
    /// The draft or the existing file is invalid; nothing was written.
    Invalid {
        errors: Vec<FieldError>,
        warnings: Vec<String>,
    },
    /// The file could not be read or written.
    Io {
        message: String,
        not_writable: bool,
    },
}

/// The revision of the bytes that were written.
#[derive(Debug)]
pub struct SaveSuccess {
    pub revision: String,
    /// Duplicates that were folded away (not an error).
    pub warnings: Vec<String>,
}

/// Reads the configuration for the editor surface.
pub fn read_view(path: &Path) -> WatchConfigView {
    let path_string = path.to_string_lossy().into_owned();

    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return WatchConfigView {
                path: path_string,
                found: false,
                revision: String::new(),
                watch: Vec::new(),
                exclude: Vec::new(),
                error: None,
            };
        }
        Err(error) => {
            return WatchConfigView {
                path: path_string,
                found: true,
                revision: String::new(),
                watch: Vec::new(),
                exclude: Vec::new(),
                error: Some(error.to_string()),
            };
        }
    };

    let revision = config::revision_of(&bytes);
    let raw = String::from_utf8_lossy(&bytes).into_owned();

    match config::parse_str_with_platform(&raw, Platform::current()) {
        Ok(loaded) => WatchConfigView {
            path: path_string,
            found: true,
            revision,
            watch: loaded.watch,
            exclude: loaded.exclude,
            error: None,
        },
        Err(error) => WatchConfigView {
            path: path_string,
            found: true,
            revision,
            watch: Vec::new(),
            exclude: Vec::new(),
            error: Some(error),
        },
    }
}

/// Validates, edits and atomically writes the configuration.
///
/// On any failure the previous bytes are left untouched.
#[allow(clippy::result_large_err)]
pub fn save(path: &Path, request: &SaveRequest) -> Result<SaveSuccess, SaveFailure> {
    let platform = Platform::current();
    let existing = match fs::read(path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(SaveFailure::Io {
                message: format!("{}: {error}", path.display()),
                not_writable: is_not_writable(&error),
            });
        }
    };

    if let Some(bytes) = &existing {
        let current_revision = config::revision_of(bytes);
        if current_revision != request.expected_revision {
            return Err(SaveFailure::Conflict(read_view(path)));
        }
    }

    let mut warnings = Vec::new();
    let watch = fold_and_validate("watch", &request.watch, platform, &mut warnings);
    let exclude = fold_and_validate("exclude", &request.exclude, platform, &mut warnings);
    let (watch, exclude) = match (watch, exclude) {
        (Ok(watch), Ok(exclude)) => (watch, exclude),
        (watch, exclude) => {
            let mut errors = Vec::new();
            if let Err(mut field_errors) = watch {
                errors.append(&mut field_errors);
            }
            if let Err(mut field_errors) = exclude {
                errors.append(&mut field_errors);
            }
            return Err(SaveFailure::Invalid { errors, warnings });
        }
    };

    let mut document = match &existing {
        Some(bytes) => match std::str::from_utf8(bytes) {
            Ok(text) => match text.parse::<DocumentMut>() {
                Ok(document) => document,
                Err(error) => {
                    return Err(SaveFailure::Invalid {
                        errors: vec![FieldError {
                            field: "form".to_string(),
                            message: format!("The configuration is not valid TOML: {error}"),
                        }],
                        warnings,
                    });
                }
            },
            Err(error) => {
                return Err(SaveFailure::Invalid {
                    errors: vec![FieldError {
                        field: "form".to_string(),
                        message: format!("The configuration is not valid UTF-8: {error}"),
                    }],
                    warnings,
                });
            }
        },
        None => {
            if !request.create_from_example {
                // Nothing to preserve: an empty document is a valid config.
                DocumentMut::new()
            } else {
                example_document()
            }
        }
    };

    if let Err(error) = replace_array(&mut document, "watch", &watch) {
        return Err(SaveFailure::Invalid {
            errors: vec![FieldError {
                field: "watch".to_string(),
                message: error,
            }],
            warnings,
        });
    }
    if let Err(error) = replace_array(&mut document, "exclude", &exclude) {
        return Err(SaveFailure::Invalid {
            errors: vec![FieldError {
                field: "exclude".to_string(),
                message: error,
            }],
            warnings,
        });
    }

    let text = document.to_string();
    if let Err(error) = config::parse_str_with_platform(&text, platform) {
        return Err(SaveFailure::Invalid {
            errors: vec![FieldError {
                field: "form".to_string(),
                message: format!("The edited configuration is not valid: {error}"),
            }],
            warnings,
        });
    }

    write_atomic(path, text.as_bytes()).map_err(|error| SaveFailure::Io {
        not_writable: is_not_writable(&error),
        message: format!("{}: {error}", path.display()),
    })?;

    Ok(SaveSuccess {
        revision: config::revision_of(text.as_bytes()),
        warnings,
    })
}

fn example_document() -> DocumentMut {
    let mut document = DocumentMut::new();
    let mut watch = Array::new();
    watch.push("~/devel/*/_ai");
    document["watch"] = Item::Value(Value::Array(watch));
    let mut exclude = Array::new();
    exclude.push("**/archive/**");
    document["exclude"] = Item::Value(Value::Array(exclude));
    document
}

/// Folds exact duplicates after trimming and validates every selector.
fn fold_and_validate(
    field: &str,
    values: &[String],
    platform: Platform,
    warnings: &mut Vec<String>,
) -> Result<Vec<String>, Vec<FieldError>> {
    let mut errors = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();

    for raw in values {
        let value = normalize_selector(raw.trim(), platform);
        if value.is_empty() {
            errors.push(FieldError {
                field: field.to_string(),
                message: "Selector cannot be empty.".to_string(),
            });
            continue;
        }
        if !seen.insert(value.clone()) {
            warnings.push(format!("\"{value}\" already exists and was folded."));
            continue;
        }
        if let Err(error) = GlobBuilder::new(&value).literal_separator(true).build() {
            errors.push(FieldError {
                field: field.to_string(),
                message: format!("Invalid glob pattern \"{value}\": {error}"),
            });
            continue;
        }
        result.push(value);
    }

    if errors.is_empty() {
        Ok(result)
    } else {
        Err(errors)
    }
}

/// Replaces one string array in place, keeping the decor of retained items.
fn replace_array(document: &mut DocumentMut, key: &str, values: &[String]) -> Result<(), String> {
    if let Some(item) = document.get(key) {
        let Some(existing) = item.as_array() else {
            return Err(format!("`{key}` must be an array of strings."));
        };

        let mut updated = existing.clone();
        updated.clear();
        for value in values {
            let retained = existing
                .iter()
                .find(|candidate| candidate.as_str() == Some(value.as_str()))
                .cloned();
            match retained {
                Some(retained) => updated.push(retained),
                None => updated.push(value.clone()),
            }
        }
        document[key] = Item::Value(Value::Array(updated));
        return Ok(());
    }

    let mut array = Array::new();
    for value in values {
        array.push(value.clone());
    }
    document[key] = Item::Value(Value::Array(array));
    Ok(())
}

/// Writes a temp file in the target directory, then renames it over `path`.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;

    let temp = temp_path(parent, path);
    {
        let mut file = fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }

    match rename_over(&temp, path) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&temp);
            Err(error)
        }
    }
}

fn temp_path(parent: &Path, target: &Path) -> PathBuf {
    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "config.toml".to_string());
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    parent.join(format!(".{name}.tmp-{}-{unique}", std::process::id()))
}

#[cfg(not(windows))]
fn rename_over(temp: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(temp, target)
}

#[cfg(windows)]
fn rename_over(temp: &Path, target: &Path) -> std::io::Result<()> {
    // Windows `rename` does not replace an existing file. The window between
    // the two calls is tiny and this is the only writer docdeck owns.
    if target.exists() {
        fs::remove_file(target)?;
    }
    fs::rename(temp, target)
}

#[cfg(unix)]
fn is_not_writable(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::PermissionDenied
        || error.raw_os_error() == Some(libc::EROFS)
}

#[cfg(not(unix))]
fn is_not_writable(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::PermissionDenied
}
