use std::fs;
use std::path::{Path, PathBuf};

use tempfile::tempdir;

use crate::instance::{
    is_process_alive, read_record, remove_record_file, remove_record_if_owned, resolve_record_path,
    validate_record, wants_quit, write_record, InstanceRecord, MAX_RECORD_BYTES, RECORD_VERSION,
};

fn record(pid: u32) -> InstanceRecord {
    InstanceRecord {
        version: RECORD_VERSION,
        pid,
        exe: "/usr/bin/docdeck".to_string(),
        argv: vec!["/usr/bin/docdeck".to_string(), "plan.md".to_string()],
        cwd: "/tmp/project".to_string(),
        started_at: 1_793_700_000_000,
    }
}

fn write_raw(path: &Path, contents: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, contents).unwrap();
}

#[test]
fn record_path_prefers_xdg_runtime_dir() {
    let resolved = resolve_record_path(
        Some(Path::new("/run/user/1000")),
        Some(Path::new("/home/user")),
        Some(Path::new("/appdata")),
    )
    .unwrap();
    assert_eq!(
        resolved,
        PathBuf::from("/run/user/1000/docdeck/instance.json")
    );
}

#[test]
fn record_path_falls_back_to_home_then_local_app_data() {
    let home = resolve_record_path(None, Some(Path::new("/home/user")), None).unwrap();
    assert_eq!(
        home,
        PathBuf::from("/home/user/.local/state/docdeck/instance.json")
    );

    let windows =
        resolve_record_path(None, None, Some(Path::new("C:/Users/user/AppData/Local"))).unwrap();
    assert_eq!(
        windows,
        PathBuf::from("C:/Users/user/AppData/Local/docdeck/instance.json")
    );

    assert!(resolve_record_path(None, None, None).is_none());
    assert!(resolve_record_path(Some(Path::new("")), Some(Path::new("")), None).is_none());
}

#[test]
fn record_round_trips_through_json() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("docdeck/instance.json");
    let expected = record(42);

    write_record(&expected, &path).unwrap();

    assert_eq!(read_record(&path).unwrap(), expected);
    let raw = fs::read_to_string(&path).unwrap();
    assert!(raw.contains("\"startedAt\""));
    assert!(!raw.contains("started_at"));
    assert!(!dir.path().join("docdeck").read_dir().unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")
    }));
}

#[test]
fn read_rejects_missing_oversized_and_malformed_records() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("docdeck/instance.json");

    assert!(read_record(&path).is_err());

    write_raw(&path, &"x".repeat((MAX_RECORD_BYTES + 1) as usize));
    assert!(read_record(&path).is_err());

    write_raw(&path, "{not json");
    assert!(read_record(&path).is_err());

    write_raw(
        &path,
        r#"{"version":2,"pid":1,"exe":"/bin/docdeck","argv":["docdeck"],"cwd":"/tmp","startedAt":1}"#,
    );
    assert!(read_record(&path).is_err());

    write_raw(
        &path,
        r#"{"version":1,"pid":"nope","exe":"/bin/docdeck","argv":["docdeck"],"cwd":"/tmp","startedAt":1}"#,
    );
    assert!(read_record(&path).is_err());
}

#[test]
fn validate_rejects_relative_paths_and_empty_arguments() {
    let mut value = record(1);
    value.exe = "docdeck".to_string();
    assert!(validate_record(&value).is_err());

    let mut value = record(1);
    value.cwd = String::new();
    assert!(validate_record(&value).is_err());

    let mut value = record(1);
    value.argv.clear();
    assert!(validate_record(&value).is_err());

    let mut value = record(1);
    value.pid = 0;
    assert!(validate_record(&value).is_err());
}

#[test]
fn cleanup_only_removes_the_matching_process_record() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("docdeck/instance.json");
    write_record(&record(7), &path).unwrap();

    assert!(!remove_record_if_owned(&path, 8).unwrap());
    assert!(path.exists());

    assert!(remove_record_if_owned(&path, 7).unwrap());
    assert!(!path.exists());

    assert!(!remove_record_if_owned(&path, 7).unwrap());
}

#[test]
fn malformed_records_are_not_removed_by_owned_cleanup() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("docdeck/instance.json");
    write_raw(&path, "{not json");

    assert!(!remove_record_if_owned(&path, 7).unwrap());
    assert!(path.exists());

    remove_record_file(&path).unwrap();
    assert!(!path.exists());
}

#[cfg(unix)]
#[test]
fn writes_private_directory_and_file() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempdir().unwrap();
    let path = dir.path().join("docdeck/instance.json");
    write_record(&record(1), &path).unwrap();

    let directory_mode = fs::metadata(path.parent().unwrap())
        .unwrap()
        .permissions()
        .mode()
        & 0o777;
    let file_mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;

    assert_eq!(directory_mode, 0o700);
    assert_eq!(file_mode, 0o600);
}

#[test]
fn quit_flag_is_recognized_only_as_a_control_argument() {
    let argv = vec![
        "docdeck".to_string(),
        "--quit".to_string(),
        "plan.md".to_string(),
    ];
    assert!(wants_quit(&argv));

    let argv = vec!["docdeck".to_string(), "plan.md".to_string()];
    assert!(!wants_quit(&argv));
}

#[cfg(unix)]
#[test]
fn current_process_is_alive_and_pid_zero_is_not() {
    assert!(is_process_alive(std::process::id()));
    assert!(!is_process_alive(0));
}
