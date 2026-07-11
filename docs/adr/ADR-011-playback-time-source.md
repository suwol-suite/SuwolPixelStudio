# ADR-011: Use monotonic delta playback

Status: Accepted

The UI supplies `requestAnimationFrame` monotonic deltas to a pure scheduler. The scheduler owns no wall clock and supports mixed duration, Loop, Once, and Ping-pong. This makes large jumps and reverse ranges deterministic in tests and prevents playback from entering document history. Timer-per-Frame scheduling was rejected because drift accumulates and background throttling is difficult to reconcile.
