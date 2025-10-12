{
  "targets": [
    {
      "target_name": "sqlite",
      "sources": [
        "src/native/sqlite_addon.cc",
        "src/third_party/sqlite/sqlite3.c"
      ],
      "libraries": [ ],
      "cflags_c": ["-O3"],
      "cflags_cc": ["-O3"],
      "include_dirs": ["<@(module_root_dir)/src/third_party/sqlite"],
      "defines": [
        "SQLITE_THREADSAFE=1",
        "SQLITE_DEFAULT_MEMSTATUS=0",
        "SQLITE_OMIT_LOAD_EXTENSION",
        "SQLITE_OMIT_DEPRECATED"
      ]
    }
  ]
}
