import Foundation
import Security
import CryptoKit

// This v1 executable is built and signed once, then copied byte-for-byte into
// updates. Changing it requires an explicit credential-vault migration.
let parentRequirement = "__JARVIS_PARENT_REQUIREMENT__"
func fail() -> Never {
 FileHandle.standardError.write(Data("Credential vault access failed.\n".utf8)); exit(1)
}
var parent: SecCode?
var requirement: SecRequirement?
guard SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributePid as String: getppid()] as CFDictionary, [], &parent) == errSecSuccess,
 let parent = parent,
 SecRequirementCreateWithString(parentRequirement as CFString, [], &requirement) == errSecSuccess,
 let requirement = requirement,
 SecCodeCheckValidity(parent, [], requirement) == errSecSuccess else { fail() }
// No files, paths or caller-selected keychain services are accepted.
var requestData = Data()
do {
 while let chunk = try FileHandle.standardInput.read(upToCount: 16384), !chunk.isEmpty {
  requestData.append(chunk)
  guard requestData.count <= 131072 else { fail() }
 }
} catch { fail() }
guard requestData.count <= 131072,
 let request = try? JSONSerialization.jsonObject(with: requestData) as? [String: String],
 let action = request["action"], ["seal", "open"].contains(action),
 let encoded = request["data"], let input = Data(base64Encoded: encoded), input.count <= (action == "seal" ? 65536 : 65564) else { fail() }
let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
 kSecAttrService as String: "com.sultan.jarvis.credential-vault.v1.release", kSecAttrAccount as String: "local-wrap-key"]
var item: CFTypeRef?
var lookup = query; lookup[kSecReturnData as String] = true
var status = SecItemCopyMatching(lookup as CFDictionary, &item)
if status == errSecItemNotFound {
 // Never replace a missing wrapping key when opening existing ciphertext.
 guard action == "seal" else { fail() }
 var bytes = Data(count: 32)
 guard bytes.withUnsafeMutableBytes({ SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }) == errSecSuccess else { fail() }
 var trusted: SecTrustedApplication?; var access: SecAccess?
 guard SecTrustedApplicationCreateFromPath(nil, &trusted) == errSecSuccess, let trusted = trusted,
 SecAccessCreate("JARVIS Credential Vault" as CFString, [trusted] as CFArray, &access) == errSecSuccess, let access = access else { fail() }
 var add = query; add[kSecValueData as String] = bytes; add[kSecAttrAccess as String] = access
 status = SecItemAdd(add as CFDictionary, nil)
 if status == errSecDuplicateItem { status = SecItemCopyMatching(lookup as CFDictionary, &item) }
 else if status == errSecSuccess { item = bytes as CFData }
}
guard status == errSecSuccess, let bytes = item as? Data, bytes.count == 32 else { fail() }
let key = SymmetricKey(data: bytes)
do {
 let output: Data
 if action == "seal" { guard let combined = try AES.GCM.seal(input, using: key).combined else { fail() }; output = combined }
 else { output = try AES.GCM.open(AES.GCM.SealedBox(combined: input), using: key) }
 let response = try JSONSerialization.data(withJSONObject: ["data": output.base64EncodedString()])
 FileHandle.standardOutput.write(response)
} catch { fail() }
