#!/usr/bin/env node
/**
 * Patch electron-builder's NSIS uninstall helpers to keep the NSIS stack balanced.
 *
 * app-builder-lib@26.8.1's installUtil.nsh reads macro parameters with
 * `Exch $rootKey...` but does not pop the exchanged stack slot. In ClawX's
 * assisted per-machine upgrade path this can leave values such as
 * `SHELL_CONTEXT` on the stack. The next plugin call (`Nsis7z::ExtractWithDetails`)
 * then reads that stale value instead of its own result, producing misleading
 * installer failures like:
 *
 *   Failed to decompress files. Please try running the installer again.
 *   SHELL_CONTEXT
 *
 * Some Nsis7z builds also return "0" after a successful ExtractWithDetails
 * call instead of the "success" string expected by app-builder-lib. Accept
 * both success shapes; non-zero / non-success results still fail loudly.
 *
 * Keep this as a build-time patch so reinstalling dependencies does not
 * silently reintroduce these installer bugs.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const pnpmDir = join(process.cwd(), 'node_modules', '.pnpm');

if (!existsSync(pnpmDir)) {
  process.exit(0);
}

let patched = 0;

for (const entry of readdirSync(pnpmDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith('app-builder-lib@')) {
    continue;
  }

  const target = join(
    pnpmDir,
    entry.name,
    'node_modules',
    'app-builder-lib',
    'templates',
    'nsis',
    'include',
    'installUtil.nsh',
  );

  if (!existsSync(target)) {
    continue;
  }

  let content = readFileSync(target, 'utf8');
  const original = content;

  content = content.replace(
    '  Exch $rootKey_uninstallResult\r\n\r\n  ${if} "$rootKey_uninstallResult" == "SHELL_CONTEXT"',
    '  Exch $rootKey_uninstallResult\r\n  Pop $R9\r\n\r\n  ${if} "$rootKey_uninstallResult" == "SHELL_CONTEXT"',
  );
  content = content.replace(
    '  Exch $rootKey_uninstallResult\n\n  ${if} "$rootKey_uninstallResult" == "SHELL_CONTEXT"',
    '  Exch $rootKey_uninstallResult\n  Pop $R9\n\n  ${if} "$rootKey_uninstallResult" == "SHELL_CONTEXT"',
  );
  content = content.replace(
    '  ClearErrors\r\n  Exch $rootKey\r\n\r\n  Push 0',
    '  ClearErrors\r\n  Exch $rootKey\r\n  Pop $R9\r\n\r\n  Push 0',
  );
  content = content.replace(
    '  ClearErrors\n  Exch $rootKey\n\n  Push 0',
    '  ClearErrors\n  Exch $rootKey\n  Pop $R9\n\n  Push 0',
  );

  if (content !== original) {
    writeFileSync(target, content, 'utf8');
    patched++;
    console.log(`[patch-electron-builder-nsis-stack] Patched ${target}`);
  }

  const extractTarget = join(
    pnpmDir,
    entry.name,
    'node_modules',
    'app-builder-lib',
    'templates',
    'nsis',
    'include',
    'extractAppPackage.nsh',
  );

  if (!existsSync(extractTarget)) {
    continue;
  }

  content = readFileSync(extractTarget, 'utf8');
  const extractOriginal = content;

  content = content.replace(
    '  Pop $R0\r\n  StrCmp $R0 "success" +3\r\n    MessageBox MB_OK|MB_ICONEXCLAMATION "$(decompressionFailed)$\\n$R0"\r\n    Quit',
    '  Pop $R0\r\n  StrCmp $R0 "success" +4\r\n  StrCmp $R0 "0" +3\r\n    MessageBox MB_OK|MB_ICONEXCLAMATION "$(decompressionFailed)$\\n$R0"\r\n    Quit',
  );
  content = content.replace(
    '  Pop $R0\n  StrCmp $R0 "success" +3\n    MessageBox MB_OK|MB_ICONEXCLAMATION "$(decompressionFailed)$\\n$R0"\n    Quit',
    '  Pop $R0\n  StrCmp $R0 "success" +4\n  StrCmp $R0 "0" +3\n    MessageBox MB_OK|MB_ICONEXCLAMATION "$(decompressionFailed)$\\n$R0"\n    Quit',
  );

  if (content !== extractOriginal) {
    writeFileSync(extractTarget, content, 'utf8');
    patched++;
    console.log(`[patch-electron-builder-nsis-stack] Patched ${extractTarget}`);
  }
}

if (patched > 0) {
  console.log(`[patch-electron-builder-nsis-stack] Done. Patched ${patched} file(s).`);
}
