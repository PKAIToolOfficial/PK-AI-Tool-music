# PK AI Tool

Phase 3B adds server-validated profile editing, public profile views, follow/unfollow relationships, and unique referral tracking. Existing environment variable names and routes remain unchanged.

Profiles and referral records persist under `DATA_DIR` when configured. Paid conversion is counted only after the existing session reports a paid/confirmed status. Referral rewards are represented as recorded conversion counts; no credits or monetary value are granted automatically without a separate verified billing integration. No owner or provider details are exposed.
