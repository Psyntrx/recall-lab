# Universal Design & Interface Guidelines for AI Coding Agents

> **Role & Purpose:** This document establishes the foundational design philosophy, UI/UX principles, motion standards, and engineering practices expected of AI coding agents and developers when implementing or modifying user interfaces.
>
> It is designed to be **completely project-agnostic**. It can be placed in any repository, across any industry, design aesthetic, technology stack, or application type.

---

## 1. Hierarchy of Design Authority

When designing or implementing interface changes, follow this strict hierarchy of precedence:

1. **Explicit User Instructions & Product Requirements**  
   The immediate task description, user prompt, and explicit functional requirements always take the highest priority.
2. **Project-Specific Design Documentation & Established Tokens**  
   Any existing project design guides, design systems, style guides, Figma specifications, brand books, Tailwind configurations, or CSS theme variables within the repository.
3. **Universal Agent Design Guidelines (`AGENT_DESIGN_GUIDELINES.md`)**  
   This document. Governs general design philosophy, motion standards, user experience quality, engineering integrity, and verification workflows.
4. **General Design Inspirations & Defaults**  
   Standard industry design patterns and fallback conventions.

> [!IMPORTANT]
> **No Universal Palette or Template:** Never impose the visual appearance, color palette, layout, or branding of a previous project onto a new one simply because this guide is present. Visual identity is always project-dependent. Accessibility, functional correctness, and truthful state representation are non-negotiable across all projects.

---

## 2. Design Philosophy & Foundational References

Treat the following design references as **philosophical lenses**, not templates to clone. Extract their underlying principles without copying proprietary brand assets, logos, layouts, or color schemes.

| Design Reference | Core Principle to Extract | How to Apply in Practice |
|---|---|---|
| **Apple** | Purposeful, fluid motion & spatial clarity | Every animation should clarify physical spatial relationships, respond immediately to user touch/click, and make the interface feel continuous and alive. |
| **Linear** | Precision, minimalism & structured clarity | Strict spacing systems, restrained controls, compact status tags, scannable information, and consistent keyboard-first interaction patterns. |
| **Pentagram** | Disciplined typographic hierarchy | Intentional type scale, disciplined font pairing, careful line-height calibration, and respecting text as an architectural element. |
| **Muji** | Functional minimalism & noise reduction | Strip away gratuitous borders, superfluous decorations, redundant labels, and unnecessary containers. Let content breathe. |
| **Duolingo** | Approachable onboarding & progressive guidance | Make primary actions unmissable. Introduce complexity progressively. Guide the user calmly through unfamiliar flows. |
| **Airbnb** | Intuitive search, filtering & state feedback | Clear search inputs, obvious active filter chips, straightforward selection states, and helpful, context-rich empty states. |
| **Aesop** | Considered art direction & tactile depth | Cohesive visual tone, disciplined color accents, balanced negative space, and respectful composition. |
| **Notion** | Modular information architecture | Flexible blocks, scannable nesting, clean metadata presentation, and intuitive grouping of related information. |
| **Stripe** | Content hierarchy & narrative flow | Clear section progression, crisp visual hierarchy, thoughtful micro-copy, and confident value presentation. |
| **Framer** | Refined micro-interactions | Micro-feedback on hover, press, focus, and loading that provides tactile satisfaction and immediate confirmation. |

---

## 3. Project-Dependent Visual Identity

An AI agent must **never** assume or prescribe a predetermined aesthetic (such as dark command centres, pastel dashboards, glassmorphism, or flat minimalism) unless dictated by the project itself.

### The Identity Discovery Workflow
Before writing or modifying UI code, every agent must execute the following discovery steps:

1. **Inspect the Existing Codebase:**
   - Scan configuration files (`tailwind.config.*`, CSS modules, `theme.json`, styling tokens).
   - Identify existing font imports and typography scales.
   - Inspect existing shared UI components (buttons, cards, badges, inputs, dialogs).
   - Identify existing color scales, corner radii (`border-radius`), border treatments, and elevation/shadow systems.
2. **Read Project-Specific Design Documentation:**
   - Check for local design docs, brand guidelines, or README notes describing the intended aesthetic.
3. **Understand the Target Product & Audience:**
   - Discern whether the product is an internal developer tool, enterprise B2B dashboard, consumer mobile app, editorial publication, or e-commerce platform.
4. **Extend, Do Not Reinvent:**
   - Build upon the established visual language. Preserve existing design tokens, components, and layout patterns unless explicitly asked to redesign.
5. **Establish a Cohesive Identity When None Exists:**
   - If starting a brand-new project with no design system in place, propose a clean, coherent, and accessible visual system tailored to the product's domain. Ensure proper contrast, cohesive typography, and consistent spacing before proceeding.

---

## 4. Motion & Interaction System

Animation should make an interface feel responsive, tactile, and clear. Motion must always serve usability — **never exist as gratuitous decoration**.

### Fluidity Principles
- **Immediate Response:** Controls must acknowledge user input instantaneously. Laggy or delayed transitions make interfaces feel sluggish.
- **Physical Continuity:** Elements should enter and exit with natural momentum. Use easing curves that reflect physical weight (e.g., standard ease-out for entering elements, ease-in for exiting elements).
- **Preserve Existing Motion:** If the application already has well-calibrated transitions and animations, preserve them. Do not replace working motion with heavier, slower, or jarring alternatives.
- **Performance First:** Prioritize animating composited properties (`transform`, `opacity`). Avoid animating layout properties (`width`, `height`, `top`, `margin`, `padding`) unless strictly necessary.

### Standard Interaction Baseline Timings
Use these benchmarks as starting points when introducing new transitions, adjusting to match existing project conventions:

- **Press & Focus Feedback:** ~`100ms – 160ms` (snappy, tactile acknowledgment).
- **Hover & State Transitions:** ~`140ms – 200ms` (smooth color/shadow/transform shifts).
- **Popovers, Menus & Tooltips:** ~`160ms – 220ms` (subtle scale and opacity fade).
- **Drawers, Sheets & Modals:** ~`200ms – 300ms` (directional slide and backdrop fade).
- **Page & View Transitions:** ~`180ms – 280ms` (coordinated content cross-fade or subtle stagger).
- **Ambient & Idle Cycles:** Slow, continuous or gentle cycles (several seconds). Ambient effects must be restrained and never distract from content or mimic operational activity.

### Interactive Element States
Every interactive element (buttons, inputs, links, list items, toggles) must provide distinct, deliberate states:
- `default`: Clear affordance that the element is interactive.
- `hover`: Subtle visual lift or color shift indicating cursor focus.
- `focus-visible`: High-contrast, accessible outline or ring for keyboard navigation.
- `pressed / active`: Physical depression or scale response confirming click/touch.
- `disabled`: Muted appearance with `cursor: not-allowed` or `pointer-events: none` and `aria-disabled="true"`.
- `loading`: Subtle spinner or skeleton; the control must be disabled against multiple clicks while maintaining layout stability.
- `success / error`: Immediate visual confirmation of task outcome (e.g., checkmark pulse, error shake, or contextual alert).

### Accessibility & Reduced Motion
Always implement `prefers-reduced-motion` compliance:
- When reduced motion is preferred by the operating system, suppress spatial movement, slides, and scaling.
- Replace animated transitions with instantaneous changes or simple, rapid opacity fades.
- Never autoplay rapid strobe, flashing, or high-frequency cycling animations.

---

## 5. Universal UI/UX Principles

### Typography & Editorial Discipline
- **Hierarchy:** Establish a sharp hierarchy between page headings (H1), section headers (H2), subsection titles (H3), body copy, and secondary metadata.
- **Readability:** Maintain comfortable line lengths (45–75 characters per line for long-form prose) and proportional line heights (`1.4–1.6` for body text, `1.1–1.25` for large headings).
- **Collision Prevention:** Text must be treated as a dynamic layout element. Always handle dynamic lengths gracefully with intentional wrapping, flex wrapping, or controlled truncation with tooltips. Headings, labels, and action buttons must never collide or overlap across viewport sizes.
- **Monospace Usage:** Restrict monospace fonts to code snippets, cryptographic keys, raw query outputs, or tabular numeric comparisons where alignment is critical.

### Spatial Discipline & Layout Structure
- **Grid & Spacing Scale:** Stick strictly to the project's spacing scale (e.g., 4px/8px incremental grid). Consistent spacing builds subconscious trust.
- **Whitespace Over Dividers:** Prefer whitespace, column grouping, and subtle surface differentiation over heavy borders and horizontal dividing lines.
- **Card Nesting:** Avoid unnecessary card-inside-a-card nesting. Use grouping, headers, and spatial separation before introducing an additional layer of containment.
- **Reflow Over Shrinking:** Responsive design means reflowing content into logical stacks and grids, not shrinking text and tap targets until they are illegible.

### Information Architecture & Human Language
- **Plain, Human-Centric Copy:** User-facing interfaces should communicate in natural, approachable language.
- **Hide Implementation Artifacts:** Never expose raw database column names, internal IDs, backend enum keys (e.g., `USER_STATE_PENDING_VERIFICATION`), or raw JSON payloads in primary UI views. Format them cleanly (e.g., "Pending Verification").
- **Concise Labels:** Keep UI labels clear and meaningful. Avoid cryptic single-word acronyms or overly verbose sentences in tight UI components.

### States & Edge Cases
Every data-driven component must account for the full spectrum of UI states:
1. **Loading State:** Display intentional skeleton loaders that mirror the actual final layout shape, avoiding sudden layout shifts (CLS).
2. **Empty State:** When no data exists, present a helpful, reassuring empty state explaining *why* it is empty and what action the user can take to populate it.
3. **Error State:** Explain what went wrong in plain language and offer a direct recovery action (e.g., "Retry", "Check Connection", "Clear Filters").
4. **Success / Confirmation State:** Provide clear, immediate feedback when an action completes successfully.
5. **Partial / Filtered State:** When filters yield no results, clearly show which filters are applied and provide a one-click "Reset Filters" action.

### Overlays, Dialogs & Stacking Contexts
- **Viewport Boundary Awareness:** Menus, popovers, and tooltips must dynamically detect viewport edges and flip or shift position to prevent clipping.
- **Consistent Stacking (Z-Index Scale):** Rely on a structured, documented z-index scale (e.g., base, dropdown, sticky header, modal backdrop, modal content, toast/notification). Never fix layering bugs by blindly appending `z-[999999]`.
- **Dismissal Behavior:** All non-modal overlays and popovers must support dismissal via outside click, clicking an explicit close button, and pressing the `Escape` key.
- **Focus Trapping & Restoration:** Modals must trap keyboard focus within the dialog while open, and restore focus to the triggering element upon closure. Prevent background body scrolling when a modal is open.

### Theme Architecture (Light & Dark)
When supporting multiple themes:
- **Semantic Color Tokens:** Never hard-code absolute hex or RGB values in components. Use semantic design tokens (e.g., `bg-surface-primary`, `text-content-subtle`, `border-muted`).
- **Meaningfully Distinct:** Dark and light modes must each feel native and carefully tuned. Dark mode should use rich, comfortable dark surfaces with balanced contrast; light mode should use clean, crisp surfaces with deep text ink.
- **Contrast & Visibility:** Verify that all text, status indicators, and interactive borders meet WCAG AA contrast standards (minimum 4.5:1 for normal text, 3:1 for large text and UI components) in **both** modes.
- **No Flash of Unstyled Content (FOUC):** Theme selection must persist correctly (via local storage/cookie) and initialize synchronously to avoid white-to-dark flashes on page load.

---

## 6. Engineering Integrity for UI Implementation

AI agents must write robust, production-grade code that integrates cleanly with the surrounding codebase.

### Repository Respect & Discovery
- **Inspect Before Editing:** Always inspect existing components, styling patterns, package dependencies, and directory structures before introducing new code.
- **Reuse Existing Primitives:** If the repository contains a shared `<Button />`, `<Card />`, `<Input />`, or icon library, use it. Do not generate duplicate one-off primitives.
- **Keep Changes Scoped:** Confine edits to the requested feature or component. Do not gratuitously refactor unrelated files, dependencies, or backend services during a visual task.
- **Respect Framework Conventions:** Adhere to the established conventions of the project's framework (e.g., Next.js App Router rules, React 19 Server/Client Component boundaries, Vue Composables, Svelte stores). Handle time-dependent or client-only rendering cleanly without causing hydration mismatches.

### Truthful UI & Operational States
- **No Decorative Deception:** Never render a button, link, toggle, or control that appears functional if it has no handler or action attached. If a feature is not yet available, explicitly disable the control, mark it as disabled, or display an honest "Coming Soon" status.
- **Never Fabricate Data:** Never replace real application data or dynamic API feeds with hardcoded dummy data just to make a screenshot or component look visually populated.
- **Truthful Operational Signals:** Status indicators (e.g., "Active", "Connected", "Running", "Failed") must strictly reflect real, backed application state. Never animate spinners or pulsing green status dots unless an actual process is live and verified.
- **Timestamp Integrity:** Validate all date/timestamp parsing. Handle timezones, relative-time updates, and localization correctly. Never render raw timestamps or allow parsing failures to display invalid dates (e.g., `NaN`, `Invalid Date`, or 50-year-old defaults).

### Activity Feeds & Event Presentation
- When displaying activity feeds, audit logs, or event streams:
  - Format raw event payloads into concise, human-readable sentences.
  - Distinctly present the actor, action description, status, and timestamp.
  - Implement reliable keys and deduplication so identical events do not clutter the view, while ensuring distinct events are never hidden accidentally.

### Error Handling & Validation
- **Investigate, Never Suppress:** Do not suppress errors, silence linter warnings with broad escape hatches, or catch and ignore exceptions without investigating their root cause.
- **Continuous Validation:** Validate all changes using the project's native verification tools:
  - Run type checking (e.g., `tsc --noEmit`).
  - Run linter suites (e.g., `npm run lint`).
  - Run existing test suites (unit, integration, component).
  - Verify production builds (e.g., `npm run build`).

---

## 7. Responsive Quality Assurance & Viewport Auditing

Before concluding any visual or layout modification, inspect and verify the rendered interface across standard representative breakpoints:

| Device Category | Target Viewport Width | Primary Verification Focus |
|---|---|---|
| **Large Desktop** | ~`1440px` | Content max-widths, multi-column balance, negative space distribution. |
| **Standard Laptop** | ~`1280px` | Sidebar transitions, dashboard card reflow, dense data tables. |
| **Tablet** | ~`768px` | Adaptive layout switches, horizontal navigation turning into drawer/sheet, touch target spacing. |
| **Mobile** | ~`375px – 390px` | Single-column stacking, mobile navigation, sticky action bars, full-width buttons, no horizontal scroll. |

### Visual Quality Checklist
Inspect the rendered application for the following common UI flaws:
- [ ] **No Horizontal Overflow:** The page and child containers must never accidentally trigger horizontal window scrolling.
- [ ] **No Text Collisions or Truncation Bugs:** Headings, tags, badges, and metadata must wrap or truncate intentionally without overlapping neighboring elements.
- [ ] **Accessible Tap Targets:** Interactive controls must have minimum tap targets of at least 44×44px on mobile and touch devices.
- [ ] **Stable Overlays:** Menus, tooltips, dialogs, and sheets must remain fully within the viewport bounds and dismiss cleanly.
- [ ] **Fluid Layout Transitions:** Expanding or collapsing sidebars, accordion panels, and drawers must reflow surrounding content smoothly without abrupt jumps.
- [ ] **Zero Layout Shift (CLS):** Media elements, dynamic cards, and async data regions must reserve space or display sized skeletons while loading.

---

## 8. Agent Final Acceptance Gate

An interface change or feature implementation is complete **only** when all of the following criteria are satisfied:

1. **Brand & Identity Consistency:** The interface strictly aligns with the existing project's design system and tokens, without imposing foreign styles or unapproved palettes.
2. **Typography & Readability:** Text is legible, properly proportioned, comfortable to read, and free of overlap across all viewports.
3. **Responsive Geometry:** The layout renders cleanly across mobile, tablet, laptop, and desktop screen sizes without broken alignments or horizontal overflow.
4. **State Completeness:** Default, hover, focus, active, disabled, loading, empty, and error states are handled and visually coherent.
5. **Purposeful Motion:** Animations feel immediate, fluid, and purposeful; reduced-motion preferences are respected.
6. **Functional Honesty:** All interactive elements have genuine handlers; no fake operational telemetry or fabricated data has been introduced.
7. **Accessibility Compliance:** Keyboard navigation works seamlessly with visible `:focus-visible` indicators; color contrast meets WCAG AA standards.
8. **Engineering Verification:** The project's existing lint, typecheck, test, and build commands execute successfully with zero newly introduced errors.
