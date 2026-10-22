// Run interactively. No token is accepted through argv, environment, or files.
import Foundation
import Security
import Darwin

let service = "co.nz.rrgallery.wise.readonly"
let account = "aud-reconciliation"
let fromPipe = CommandLine.arguments.dropFirst().elementsEqual(["--from-stdin"])
let token: String
if fromPipe {
    guard isatty(STDIN_FILENO) == 0, let input = readLine() else { exit(1) }
    token = input
} else {
    guard isatty(STDIN_FILENO) == 1 else {
        fputs("Run this in an interactive terminal.\n", stderr); exit(1)
    }
    guard let secret = getpass("Paste Wise READ ONLY token (hidden), then press Return: ") else { exit(1) }
    token = String(cString: secret)
    memset(secret, 0, strlen(secret))
}
guard !token.isEmpty, token.count <= 4096, !token.contains(where: { $0.isWhitespace }) else {
    fputs("Invalid token format; nothing saved.\n", stderr); exit(1)
}
let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service, kSecAttrAccount as String: account]
let attributes: [String: Any] = [kSecValueData as String: Data(token.utf8),
    kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
var item = query
attributes.forEach { item[$0.key] = $0.value }
let status = SecItemAdd(item as CFDictionary, nil)
if status == errSecDuplicateItem {
    // Never replace a previously configured credential without explicit operator action.
    fputs("A token already exists in Keychain. No replacement was made.\n", stderr); exit(1)
}
guard status == errSecSuccess else { fputs("Keychain save failed.\n", stderr); exit(1) }
print("Saved in this Mac's login Keychain. Token was not printed or written to a file.")
