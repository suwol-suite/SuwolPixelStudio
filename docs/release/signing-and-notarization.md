# Signing and notarization

The macOS workflow reads Organization Secrets `CSC_LINK`, `CSC_KEY_PASSWORD`, `MAC_KEYCHAIN_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID`, and `APPLE_APP_SPECIFIC_PASSWORD`. Store `CSC_LINK` as the base64 Developer ID Application PKCS#12 payload (an optional `data:application/x-pkcs12;base64,` prefix is accepted). The job decodes it into `RUNNER_TEMP`, imports it into a temporary keychain, discovers the Developer ID identity without printing secret values, and deletes the keychain and certificate in an `always()` cleanup step.

Forge signs the arm64 app with hardened runtime and the minimal Electron JIT entitlements, submits it with `notarytool`, and staples it. The workflow then signs the generated DMG, submits and staples the DMG separately. Upload is allowed only after `codesign --verify --deep --strict --verbose=2`, `spctl --assess`, and `xcrun stapler validate` succeed for the applicable app and disk image.

Core and final detached checksum signatures use Organization Secrets `GPG_PRIVATE_KEY_B64` and `GPG_PASSPHRASE`. Each signing step creates a mode-0700 temporary `GNUPGHOME`, imports the decoded private key without logging it, signs with loopback pinentry, runs `gpg --verify checksums.txt.asc checksums.txt`, and removes the keyring with a shell trap. The macOS follow-up re-signs the complete five-platform-asset checksum and uploads both checksum files with `--clobber`.

PR CI and ordinary package smoke builds receive no signing secrets. Rotate or revoke compromised credentials and rerun only from a reviewed immutable tag.
