cmd_Release/sqlite.node := ln -f "Release/obj.target/sqlite.node" "Release/sqlite.node" 2>/dev/null || (rm -rf "Release/sqlite.node" && cp -af "Release/obj.target/sqlite.node" "Release/sqlite.node")
