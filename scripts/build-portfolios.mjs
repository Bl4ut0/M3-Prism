/**
 * Build M3 Prism web client bundle and emit a verified PortfoliOS release receipt (release.json).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = path.join(root, 'app', 'client');
const distDir = path.join(clientDir, 'dist');
const appPkg = JSON.parse(fs.readFileSync(path.join(root, 'app', 'package.json'), 'utf8'));

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const build = spawnSync(npmCmd, ['run', 'build'], {
    cwd: clientDir,
    stdio: 'inherit',
    shell: process.platform === 'win32'
});
if (build.status !== 0) {
    throw new Error(`M3 Prism client build failed with exit code ${build.status}`);
}

let revision = '0000000000000000000000000000000000000000';
let dirty = false;
try {
    revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim();
    dirty = Boolean(status);
} catch {
    // Allow local pre-commit test builds before git init completes
}

function collectFiles(dir, prefix = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    const files = {};
    for (const entry of entries) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            Object.assign(files, collectFiles(abs, rel));
        } else if (entry.isFile() && rel !== 'release.json') {
            const hash = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
            files[rel] = hash;
        }
    }
    return files;
}

const files = collectFiles(distDir);
const receipt = {
    repository: 'https://github.com/Bl4ut0/M3-Prism',
    version: appPkg.version || '1.1.0',
    revision,
    dirty,
    files
};

fs.writeFileSync(path.join(distDir, 'release.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(`Built M3 Prism ${receipt.version} (${receipt.revision.slice(0, 12)}) with ${Object.keys(files).length} verified assets.`);
