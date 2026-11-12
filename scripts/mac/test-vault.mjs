import { execFileSync, spawnSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { readProfile, requirement } from "./local-signing.mjs";
const dir = resolve(".jarvis/verification/vault");
await mkdir(dir, { recursive: true });
const vault = resolve(".jarvis/private/vault-v1/jarvis-credential-vault");
const rejected = spawnSync(vault, [], {
  input: JSON.stringify({
    action: "seal",
    data: Buffer.from("untrusted-canary").toString("base64"),
  }),
  encoding: "utf8",
  timeout: 10000,
});
assert.equal(rejected.status, 1);
assert.equal(rejected.stdout, "");
const p = readProfile();
const reports = [];
for (const version of ["A", "B"]) {
  const source = join(dir, "parent-" + version + ".swift"),
    binary = join(dir, "parent-" + version);
  await writeFile(
    source,
    `
import Foundation
let vault=${JSON.stringify(vault)}
func request(_ action:String,_ data:Data)->(Int32,Data){
 let process=Process();process.executableURL=URL(fileURLWithPath:vault)
 let input=Pipe(),output=Pipe();process.standardInput=input;process.standardOutput=output;process.standardError=FileHandle.nullDevice
 do{try process.run();let json=try JSONSerialization.data(withJSONObject:["action":action,"data":data.base64EncodedString()]);input.fileHandleForWriting.write(json);try input.fileHandleForWriting.close();let result=output.fileHandleForReading.readDataToEndOfFile();process.waitUntilExit();return(process.terminationStatus,result)}catch{exit(1)}
}
let canary=Data(repeating: ${version == "A" ? 65 : 66}, count: 65536)
let sealed=request("seal",canary);guard sealed.0==0,let object=try? JSONSerialization.jsonObject(with:sealed.1) as? [String:String],let encoded=object["data"],var cipher=Data(base64Encoded:encoded) else{exit(2)}
let opened=request("open",cipher);guard opened.0==0,let decoded=try? JSONSerialization.jsonObject(with:opened.1) as? [String:String],decoded["data"]==canary.base64EncodedString() else{exit(3)}
cipher[cipher.count-1] ^= 1
let tampered=request("open",cipher);guard tampered.0 != 0,tampered.1.isEmpty else{exit(4)}
print("Trusted parent ${version}: round trip and tamper rejection passed")
`,
  );
  execFileSync("xcrun", ["swiftc", source, "-o", binary], {
    env: {
      ...process.env,
      CLANG_MODULE_CACHE_PATH: "/tmp/jarvis-swift-cache",
      SWIFT_MODULECACHE_PATH: "/tmp/jarvis-swift-cache",
    },
  });
  execFileSync("codesign", [
    "--force",
    "--sign",
    p.fingerprint,
    "--keychain",
    p.keychain,
    "--timestamp=none",
    "--identifier",
    "com.sultan.jarvis",
    "--requirements",
    "=designated => " + requirement("com.sultan.jarvis", p.fingerprint),
    binary,
  ]);
  execFileSync(binary, [], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20000,
  });
  const sig = spawnSync("codesign", ["-d", "--verbose=4", binary], {
    encoding: "utf8",
  });
  reports.push({
    version,
    hash: (sig.stdout + sig.stderr).match(/^CDHash=(.+)$/m)?.[1],
    roundTrip: true,
    tamperRejected: true,
  });
}
assert(
  reports[0].hash && reports[1].hash && reports[0].hash !== reports[1].hash,
);
const report = {
  untrustedCallerRejected: true,
  differentTrustedParentsPassed: true,
  reports,
};
await writeFile(
  join(dir, "proof.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
