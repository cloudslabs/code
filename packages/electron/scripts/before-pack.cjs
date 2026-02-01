/**
 * electron-builder beforePack hook (must be CommonJS).
 *
 * Walks the packaged node_modules directory and replaces every symlink with a
 * real copy of the target.  This is necessary because pnpm `workspace:*`
 * dependencies are resolved via symlinks and electron-builder does not
 * dereference them, causing the workspace packages (and their transitive
 * dependencies) to be missing from the final artefact.
 *
 * pnpm stores transitive deps as siblings inside
 *   .pnpm/<pkg>@<ver>/node_modules/<sibling>
 * so when a symlink points into .pnpm we also copy every sibling package
 * into the destination node_modules directory.
 */

const fs = require('fs');
const path = require('path');

/**
 * If `realPath` lives inside a `.pnpm/…/node_modules/<pkg>` directory,
 * return the `.pnpm/…/node_modules` parent so we can enumerate siblings.
 * Returns null otherwise.
 */
function pnpmNodeModulesParent(realPath) {
  // Walk upward looking for .pnpm
  const segments = realPath.split(path.sep);
  const pnpmIdx = segments.lastIndexOf('.pnpm');
  if (pnpmIdx === -1) return null;

  // The layout is: .pnpm/<hash>/node_modules/<scope>/<name>  (scoped)
  //            or: .pnpm/<hash>/node_modules/<name>           (unscoped)
  const nmIdx = segments.indexOf('node_modules', pnpmIdx + 1);
  if (nmIdx === -1) return null;

  return segments.slice(0, nmIdx + 1).join(path.sep);
}

/**
 * Copy a single package from the pnpm store into destNm.
 * If the source is itself a symlink into a different .pnpm store directory,
 * recursively copy its siblings (transitive deps) as well.
 */
function copySinglePackage(name, srcPath, destNm) {
  const destPath = path.join(destNm, name);
  if (fs.existsSync(destPath)) return;

  let realSrc;
  try {
    realSrc = fs.realpathSync(srcPath);
  } catch {
    return;
  }

  let stat;
  try {
    stat = fs.statSync(realSrc);
  } catch {
    return;
  }

  if (stat.isDirectory()) {
    // For scoped packages, ensure the scope dir exists
    if (name.includes('/')) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
    }
    fs.cpSync(realSrc, destPath, { recursive: true });
    console.log(`  [before-pack]   sibling: ${name}`);

    // If this sibling itself came from a different .pnpm store dir,
    // pull in its own transitive deps (siblings) too.
    const siblingPnpmNm = pnpmNodeModulesParent(realSrc);
    if (siblingPnpmNm) {
      copySiblings(siblingPnpmNm, destNm);
    }

    dereferenceSymlinks(destPath);
  } else {
    fs.copyFileSync(realSrc, destPath);
  }
}

/**
 * Copy all sibling packages from a .pnpm virtual store directory into `destNm`.
 * Skips packages that already exist at the destination.
 */
function copySiblings(pnpmNmDir, destNm) {
  let entries;
  try {
    entries = fs.readdirSync(pnpmNmDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const srcPath = path.join(pnpmNmDir, entry.name);

    // Handle scoped packages (@scope/name)
    if (entry.name.startsWith('@')) {
      let scopedEntries;
      try {
        scopedEntries = fs.readdirSync(srcPath);
      } catch {
        continue;
      }
      for (const sub of scopedEntries) {
        copySinglePackage(`${entry.name}/${sub}`, path.join(srcPath, sub), destNm);
      }
      continue;
    }

    copySinglePackage(entry.name, srcPath, destNm);
  }
}

function dereferenceSymlinks(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory – skip
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Check the path itself (not the dirent, which may already be resolved)
    let lstat;
    try {
      lstat = fs.lstatSync(fullPath);
    } catch {
      continue;
    }

    if (lstat.isSymbolicLink()) {
      let realPath;
      try {
        realPath = fs.realpathSync(fullPath);
      } catch {
        continue; // dangling symlink
      }

      // Remove the symlink
      fs.rmSync(fullPath, { recursive: true, force: true });

      // Copy the real content in its place
      const stat = fs.statSync(realPath);
      if (stat.isDirectory()) {
        fs.cpSync(realPath, fullPath, { recursive: true });

        // If this symlink pointed into .pnpm, copy transitive deps (siblings)
        const pnpmNm = pnpmNodeModulesParent(realPath);
        if (pnpmNm) {
          // Determine the node_modules directory that should receive siblings.
          // If the resolved package is at dir/<name>, siblings go into dir/.
          // If the resolved package is scoped dir/@scope/<name>, siblings go
          // into the grandparent node_modules (dir/../ == the node_modules dir
          // containing the scope folder).
          let destNm = dir;
          if (path.basename(dir).startsWith('@')) {
            destNm = path.dirname(dir);
          }
          copySiblings(pnpmNm, destNm);
        }

        // Recurse into the freshly-copied directory to resolve nested symlinks
        dereferenceSymlinks(fullPath);
      } else {
        fs.copyFileSync(realPath, fullPath);
      }

      console.log(`  [before-pack] resolved symlink: ${entry.name} -> ${realPath}`);
    } else if (lstat.isDirectory()) {
      dereferenceSymlinks(fullPath);
    }
  }
}

/**
 * @param {import('electron-builder').BeforePackContext} context
 */
exports.default = async function beforePack(context) {
  // Resolve appDir from context – fall back to the electron package root
  const appDir = context.packager.appDir
    ?? context.packager.info?.appDir
    ?? path.resolve(__dirname, '..');
  const nodeModules = path.join(appDir, 'node_modules');

  if (!fs.existsSync(nodeModules)) {
    console.log('[before-pack] No node_modules found – skipping symlink resolution');
    return;
  }

  console.log('[before-pack] Dereferencing pnpm symlinks in node_modules …');
  dereferenceSymlinks(nodeModules);
  console.log('[before-pack] Done.');
};
