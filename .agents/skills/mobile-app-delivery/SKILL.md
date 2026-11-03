---
name: mobile-app-delivery
description: Design, implement, or repair mobile app features for Android, iOS, Flutter, React Native, or other existing mobile stacks. Use for mobile app development, mobile interactions, platform integration, and relevant verification; ordinary responsive websites are frontend work.
---

# Mobile app delivery

Identify the requested platforms and inspect the existing framework, versions, navigation, design system, build configuration, permissions, and tests. Preserve the existing stack. If a choice would materially change platform support or product scope and cannot be inferred, ask; otherwise proceed with the smallest justified change.

- Design for the primary mobile task, safe areas, available screen space, keyboard and system navigation, touch targets, accessibility labels, readable text scaling, and relevant orientation or device sizes. Follow existing platform conventions and user-provided design.
- Handle applicable lifecycle transitions, network loss, loading, retries, duplicate actions, and permission denial. Request only permissions needed for the requested feature; do not claim unsupported platform capabilities.
- Treat device data, credentials, deep links, files, and network responses as untrusted at their boundaries. Use existing secure storage and transport practices; never embed secrets or silently send data externally.
- Verify against available project tests and builds; exercise changed flows on an available emulator or device where feasible. Report the actual platform, device or emulator, and untested platforms. Do not claim an iOS or Android build succeeded without running it.
- Keep store publication, signing changes, paid services, and external deployment outside scope unless explicitly authorized. Measure performance before claiming an improvement.
