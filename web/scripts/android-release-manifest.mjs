import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const [apkArgument, channel] = process.argv.slice(2);
if (!apkArgument || !['device-test', 'release'].includes(channel)) throw new Error('Usage: android-release-manifest.mjs APK device-test|release');
const apk = resolve(apkArgument);
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error('ANDROID_HOME is required.');
const tools = join(sdk, 'build-tools', '36.0.0');
const platform = process.platform === 'win32';
const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', platform ? 'java.exe' : 'java') : 'java';
const certificateOutput = execFileSync(java, ['-jar', join(tools, 'lib', 'apksigner.jar'), 'verify', '--verbose', '--print-certs', apk], { encoding: 'utf8' });
const certificates = [...certificateOutput.matchAll(/Signer #\d+ certificate SHA-256 digest:\s*([0-9a-f:]+)/gi)];
if (certificates.length !== 1) throw new Error('Exactly one APK signer is required.');
const certificate = certificates[0][1].replaceAll(':', '').toLowerCase();
const expected = process.env.ANDROID_SIGNING_CERT_SHA256?.replaceAll(':', '').toLowerCase();
if (!expected || !/^[a-f0-9]{64}$/.test(expected) || certificate !== expected) throw new Error('APK certificate differs from the configured installed signing identity.');
const badging = execFileSync(join(tools, platform ? 'aapt.exe' : 'aapt'), ['dump', 'badging', apk], { encoding: 'utf8' });
const packageMatch = badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m);
if (!packageMatch || packageMatch[1] !== 'com.workoutapp.phone') throw new Error('Unexpected APK package metadata.');
const manifestRows = execFileSync(join(tools, platform ? 'aapt.exe' : 'aapt'), ['dump', 'xmltree', apk, 'AndroidManifest.xml'], { encoding: 'utf8' }).split('\n');
const channelRow = manifestRows.findIndex(row => row.includes('android:name') && row.includes('"distribution_channel"'));
if (channelRow < 0 || !manifestRows.slice(channelRow + 1, channelRow + 4).some(row => row.includes('android:value') && row.includes(`"${channel}"`)))
  throw new Error('The APK embedded channel does not match the release manifest.');
const repository = 'https://github.com/yuwon6881/WorkoutApp';
const manifest = {
  schemaVersion: 1, applicationId: packageMatch[1], channel, versionName: packageMatch[3], versionCode: Number(packageMatch[2]),
  apkUrl: `${repository}/releases/download/android-${channel}/${basename(apk)}`,
  apkSha256: createHash('sha256').update(readFileSync(apk)).digest('hex'), signingCertificateSha256: certificate,
  publishedAt: new Date().toISOString(), sourceCommit: process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0
};
writeFileSync(join(dirname(apk), 'android-release.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Verified ${manifest.applicationId} build ${manifest.versionCode} (${channel}); wrote android-release.json.`);
