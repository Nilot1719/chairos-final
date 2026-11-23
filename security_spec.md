# ChairOS Firestore Security Specification

## 1. Data Invariants

1. **User Profile Ownership**: A user profile at `/users/{userId}` can only be read or written by the authenticated user whose `request.auth.uid == userId`, with `email_verified == true`.
2. **Committee Ownership & Co-Chair Membership**: A committee at `/committees/{committeeId}` must have `ownerId == request.auth.uid` and `memberIds == [request.auth.uid]` on creation; `ownerId` is immutable. Only the owner can delete the committee or update its `name`/`joinCode`. Approved co-chairs listed in `memberIds` (max 25) can read, update debate state, and leave the committee.
3. **Secret-Isolated 4-Char Join Codes**:
   - `/committeeInvites/{joinCode}` (`^[A-Z0-9]{4}$`) exposes only lookup metadata (`committeeId`, `committeeName`, `ownerId`, `joinCode`) via direct `allow get`; `allow list: if false` prevents scraping all 4-character codes.
   - `/committeeInvites/{joinCode}/secrets/lock` stores the salted SHA-256 `passcodeHash`. Non-owners have ZERO `get` or `list` access (`existing().ownerId == request.auth.uid`).
4. **Atomic Join Proof**: A chair joining via `/committees/{committeeId}/members/{uid}` must supply `passcodeProof` matching `secrets/lock.passcodeHash` and atomically join `/committees/{committeeId}.memberIds` via mutual `existsAfter`/`getAfter` checks.
5. **Subcollection Master Gate**: Every subcollection document (`delegates`, `sessions`, `motions`, `logs`, `caucuses`, `blocs`) verifies committee membership via `committees/{committeeId}` on single-document operations (`get`, `create`, `update`, `delete`), while `list` queries enforce `resource.data.ownerId == request.auth.uid || request.auth.uid in resource.data.memberIds` with zero `get()` calls.
6. **Terminal State Locking on Motions**: A motion's `status` starts as `'pending'` on creation and can transition once to `'accepted'` or `'rejected'`. Subsequent status mutations are denied.
7. **Temporal & Schema Integrity**: Every `create` checks `hasAll` + `hasOnly`, `createdAt == request.time`, and `updatedAt == request.time`. Every `update` checks `affectedKeys().hasOnly(...)` per action, preserves immutable fields (`ownerId`, `createdAt`), and enforces `updatedAt == request.time`.
8. **Projector Capability Isolation**: `/projectors/{projectorId}` stores strictly PII-free stage telemetry (`allow list: if false`, `allow get` requires an explicit valid capability ID, writes require verified committee membership).

## 2. Dirty Dozen+ Adversarial Payloads (All Must Return PERMISSION_DENIED)

1. **Identity Spoofing on Committee Create**: Signed-in User A creates `/committees/c1` with `ownerId: "user_B"`.
2. **Shadow Field Injection**: Signed-in User A creates `/committees/c1` with all valid fields plus `isAdmin: true`.
3. **Client Timestamp Forgery**: Signed-in User A creates `/committees/c1` with `createdAt: Timestamp(2020-01-01)` instead of `request.time`.
4. **Unverified Email Bypass**: User with `email_verified: false` attempts to write `/committees/c1`.
5. **ID Poisoning**: User A attempts to create `/committees/${'x'.repeat(200)}` or ID containing slashes/spaces (`"bad id!"`).
6. **Subcollection Orphan/Cross-Tenant Write**: Non-member User B creates `/committees/c1/delegates/d1` with `ownerId: "user_B"` inside User A's committee `c1`.
7. **Blanket List Query Scraping**: User B runs `getDocs(collection(db, 'committees'))` without membership filter, or runs `getDocs(collection(db, 'committeeInvites'))`.
8. **Passcode Hash Read Attempt**: Non-owner User B attempts `getDoc('/committeeInvites/K7M3/secrets/lock')`.
9. **Wrong Password Join Bypass**: User B attempts to add themselves to `committees/c1.memberIds` without a matching `passcodeProof` in `/members/{uid}`, or writes `/members/{uid}` with wrong `passcodeProof`.
10. **Hostile Member Injection**: Co-Chair B tries to add third-party `user_C` to `committees/c1.memberIds` or delete User A's committee.
11. **Terminal State Bypass on Motion**: User A updates a motion whose existing `status == 'accepted'` back to `'pending'` or `'rejected'`.
12. **PII / Profile Cross-Read**: User B attempts to `get` `/users/user_A`.
