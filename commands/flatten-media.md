---
description: 处理Jav视频文件
---

# flatten-media

将子目录中所有视频文件移动到根目录，剔除域名前缀，文件名转为大写，然后删除所有子文件夹。

## 安全边界

- **隐藏目录保留**：`.omo/`、`.codegraph/`、`.git/`、`.Trash/` 等以 `.` 开头的目录及其内文件不会被移动或删除
- **符号链接跳过**：`find` 使用 `-type f` 只处理常规文件，不跟踪符号链接
- **文件类型白名单**：只处理 `.mp4 .mov .mkv .avi .wmv` 五种扩展名（大小写不敏感）
- **垃圾文件处理**：`.torrent` `.js` `.tmp_` 等非视频文件随子目录一并删除；如需保留应提前移出
- **macOS 大小写不敏感文件系统**：根目录文件重命名使用两段式 `mv`（先临时名再目标名），避免原地重命名无效果
- **不覆盖**：`mv -n` 防止目标已存在时被覆盖

## 使用方式

```bash
# 默认当前目录
flatten-media

# 指定目标目录
flatten-media /path/to/videos

# 预览模式（不执行任何操作）
flatten-media /path/to/videos --dry-run
```

## 执行脚本

```bash
#!/usr/bin/env bash
set -euo pipefail

# === Configuration ===
TARGET="${1:-$PWD}"
DRY_RUN=false

if [ "${2:-}" = "--dry-run" ] || [ "${1:-}" = "--dry-run" ]; then
    DRY_RUN=true
    if [ "${1:-}" = "--dry-run" ]; then
        TARGET="${2:-$PWD}"
    fi
fi

if [ ! -d "$TARGET" ]; then
    echo "Error: target directory does not exist: $TARGET" >&2
    exit 1
fi

# Resolve to absolute path (macOS: no realpath available)
case "$TARGET" in
    /*) TARGET_ABS="$TARGET" ;;
    *)  TARGET_ABS="$PWD/$TARGET" ;;
esac

# === Stats counters ===
MOVED=0    # files moved from subdirs to root
RENAMED=0  # root files case-renamed
STRIPPED=0 # prefix removed from filename
DELETED=0  # subdirectories removed

# === Helper: execute or preview ===
run() {
    if [ "$DRY_RUN" = true ]; then
        echo "  [DRY-RUN] $*"
    else
        "$@"
    fi
}

# === Step 1: Process root files (strip prefix, uppercase, two-step rename) ===
echo "--- Root files: strip prefix + uppercase ---"
while IFS= read -r -d '' f; do
    d=$(dirname "$f")
    b=$(basename "$f")

    # Strip domain prefix (case-insensitive via /I)
    nb=$(echo "$b" | sed -E 's/^[A-Z0-9]+\.COM@//I')
    [ "$nb" != "$b" ] && STRIPPED=$((STRIPPED + 1))

    # Uppercase
    ub=$(echo "$nb" | tr '[:lower:]' '[:upper:]')

    if [ "$b" != "$ub" ]; then
        # Two-step: macOS APFS case-insensitive
        # mv src dst in same dir = no-op, so go through a temp name
        tmp=".__FLATTEN_TMP_$$_${ub}"
        run mv -n "$d/$b" "$d/$tmp"
        run mv -n "$d/$tmp" "$d/$ub"
        RENAMED=$((RENAMED + 1))
    fi
done < <(find "$TARGET_ABS" -maxdepth 1 -type f \
    \( -iname '*.mp4' -o -iname '*.mov' -o -iname '*.mkv' -o -iname '*.avi' -o -iname '*.wmv' \) \
    -print0)

# === Step 2: Subdir files → move to root, strip prefix, uppercase ===
echo "--- Subdirectory files: move to root + strip prefix + uppercase ---"
while IFS= read -r -d '' f; do
    b=$(basename "$f")

    # Strip prefix
    nb=$(echo "$b" | sed -E 's/^[A-Z0-9]+\.COM@//I')
    [ "$nb" != "$b" ] && STRIPPED=$((STRIPPED + 1))

    # Uppercase
    ub=$(echo "$nb" | tr '[:lower:]' '[:upper:]')

    # Cross-directory mv: source and dest are different paths,
    # so no case-insensitive FS issue — safe to rename in one step
    run mv -n "$f" "$TARGET_ABS/$ub"
    MOVED=$((MOVED + 1))
done < <(find "$TARGET_ABS" -mindepth 2 -type f \
    \( -iname '*.mp4' -o -iname '*.mov' -o -iname '*.mkv' -o -iname '*.avi' -o -iname '*.wmv' \) \
    ! -path '*/.*' -print0)

# === Step 3: Delete all non-hidden subdirectories (depth-first) ===
echo "--- Removing non-hidden subdirectories ---"
while IFS= read -r -d '' d; do
    run rm -rf "$d"
    DELETED=$((DELETED + 1))
done < <(find "$TARGET_ABS" -mindepth 1 -depth -type d ! -path '*/.*' -print0)

# === Stats ===
echo ""
echo "=== Summary ==="
printf "  %-20s %d\n" "Moved from subdirs:" "$MOVED"
printf "  %-20s %d\n" "Renamed (uppercase):" "$RENAMED"
printf "  %-20s %d\n" "Prefixes stripped:" "$STRIPPED"
printf "  %-20s %d\n" "Subdirs removed:" "$DELETED"

# === Final verification ===
echo ""
echo "=== Final state: $TARGET_ABS ==="
ls -1 "$TARGET_ABS"

# Check for any remaining non-hidden subdirs
rem=$(find "$TARGET_ABS" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -print)
if [ -n "$rem" ]; then
    echo ""
    echo "Warning: some subdirectories still exist:"
    echo "$rem"
fi
```

## 输出格式

```
--- Root files: strip prefix + uppercase ---
--- Subdirectory files: move to root + strip prefix + uppercase ---
--- Removing non-hidden subdirectories ---

=== Summary ===
  Moved from subdirs:    3
  Renamed (uppercase):   2
  Prefixes stripped:     2
  Subdirs removed:       1

=== Final state: /path/to/videos ===
ABC-001.MP4
DEF-002.MP4
GHI-003.MP4
```