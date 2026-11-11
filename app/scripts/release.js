const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const releaseType = args[0] || 'patch'; // 'major', 'minor', 'patch'

const validTypes = ['major', 'minor', 'patch'];
if (!validTypes.includes(releaseType)) {
    console.error(`Invalid release type. Choose: ${validTypes.join(', ')}`);
    process.exit(1);
}

const ROOT_PKG = path.join(__dirname, '../package.json');
const CLIENT_PKG = path.join(__dirname, '../client/package.json');
const SERVER_PKG = path.join(__dirname, '../server/package.json');
const CHANGELOG = path.join(__dirname, '../../docs/CHANGELOG.md');

function bumpVersion(currentVersion, type) {
    let [major, minor, patch] = currentVersion.split('.').map(Number);
    if (type === 'major') {
        major++; minor = 0; patch = 0;
    } else if (type === 'minor') {
        minor++; patch = 0;
    } else {
        patch++;
    }
    return `${major}.${minor}.${patch}`;
}

function updateFile(filePath, type) {
    if (!fs.existsSync(filePath)) return null;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const oldVersion = data.version || '0.0.0';
    data.version = bumpVersion(oldVersion, type);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
    console.log(`Updated ${path.basename(path.dirname(filePath))}/${path.basename(filePath)} : ${oldVersion} -> ${data.version}`);
    return data.version;
}

console.log(`--- Starting Release Workflow [${releaseType}] ---`);

// 1. Update version numbers
const newVersion = updateFile(ROOT_PKG, releaseType);
if (!newVersion) {
    console.error('Could not find root package.json');
    process.exit(1);
}

updateFile(CLIENT_PKG, releaseType);
updateFile(SERVER_PKG, releaseType);

// 2. Generate Release Notes Placeholder
const changelogHeader = `## [${newVersion}] - ${new Date().toISOString().split('T')[0]}\n\n### Added\n- \n\n### Fixed\n- \n\n### Changed\n- \n\n---\n\n`;
if (!fs.existsSync(path.dirname(CHANGELOG))) {
    fs.mkdirSync(path.dirname(CHANGELOG), { recursive: true });
}

let existingChangelog = '';
if (fs.existsSync(CHANGELOG)) {
    existingChangelog = fs.readFileSync(CHANGELOG, 'utf8');
} else {
    existingChangelog = '# Changelog\n\nAll notable changes to WebPlayer will be documented here.\n\n';
}

// Insert after the title
const logT = existingChangelog.split('\n\n');
if(logT.length > 2) {
    logT.splice(2, 0, changelogHeader.trim());
    fs.writeFileSync(CHANGELOG, logT.join('\n\n'));
} else {
    fs.writeFileSync(CHANGELOG, existingChangelog + '\n' + changelogHeader);
}

console.log(`Changelog template generated for version ${newVersion}.`);
console.log(`\nNext Steps:`);
console.log(`1. Fill out docs/CHANGELOG.md`);
console.log(`2. Run: npm run build:client`);
console.log(`3. Commit changes (ex: git commit -am "chore: release v${newVersion}")`);
