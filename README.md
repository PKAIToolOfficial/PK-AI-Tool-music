# PK AI Tool

Phase 3A adds paid workspace shortcut organization and role-based team collaboration. All existing Railway environment variable names and API routes remain unchanged. Workspace shortcuts are launched as external secure tabs (third-party sites can block embedded views); no site is proxied or framed.

Workspace data is persisted under `DATA_DIR` when configured. Because the current runtime uses process-local sessions and JSON workspace storage, use one Railway instance and an attached persistent volume; this implementation is not horizontally scalable. Team invitations return copyable, single-use, time-limited invite links; no email is sent. Paid workspace endpoints verify the current paid session through the existing health session, and all membership and role checks run server-side.
