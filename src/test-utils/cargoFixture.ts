export const CARGO_DEPENDENCY_FIXTURE = `[workspace.dependencies]
shared = "3.2.0"

[dependencies]
serde = "1.0"
shared = { workspace = true }
workspace-unresolved = { workspace = true }
duplicate = "1.0"

# commented = "9.0"
[dev-dependencies]
regex = { version = "1.6.0", default-features = false }

[build-dependencies]
cc = { version = "1.0", features = [] }
duplicate = { version = "2.0", features = [] }

[target.'cfg(unix)'.dependencies]
target-only = "9.0"
`;

export const CARGO_WORKSPACE_MEMBER_FIXTURE = `[dependencies]
shared = { workspace = true }
`;
