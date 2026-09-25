# University Proctoring Admin Portal - Evidence Vault Guidelines

## Overview

The **Evidence Vault** is the primary interface for professors to review AI-flagged violations in the University Proctoring AI system. This document provides comprehensive guidelines for the design, functionality, and implementation of this critical feature.

---

## Design Specifications

### Theme & Visual Style

**Design Philosophy:** Dark Mode / Cyber-Command Center aesthetic  
**Target Experience:** Professional, high-tech monitoring interface that conveys authority and precision

#### Color Palette

| Color Name | Hex Code | Usage |
|------------|----------|-------|
| Deep Charcoal | `#121212` | Primary background |
| Slate Dark | `#1e293b` | Secondary background |
| Neon Alert Red | `#FF3B30` | Critical violations, high-risk indicators |
| Warning Orange | `#FF9500` | High severity flags |
| Caution Yellow | `#FFCC00` | Medium severity flags |
| Success Green | `#34C759` | Low severity, resolved status |
| Primary Blue | `#007AFF` | Interactive elements, progress indicators |
| Cyan Accent | `#06b6d4` | Highlights, active states |

#### Typography

- **Primary Font:** Inter or Roboto (Clean Sans-Serif)
- **Monospace Font:** JetBrains Mono or Fira Code (for timestamps, data)
- **Font Weights:** 400 (regular), 600 (semibold), 700 (bold)

#### Visual Aesthetics

- **Glassmorphism effects** with backdrop blur
- **Rounded corners** (8px - 16px border radius)
- **Subtle shadows** for depth and hierarchy
- **Gradient overlays** for premium feel
- **Smooth animations** using Motion/React (formerly Framer Motion)

---

## Core Features & Components

### 1. Session Header

**Purpose:** Provide at-a-glance context about the exam session under review

#### Elements:

**Student Details Section:**
- Student ID (e.g., STU-2024-8376)
- Roll Number (e.g., CS-2021-047)
- Avatar circle with student initial
- Color-coded identity badge

**Exam Context Section:**
- Exam name/title
- Date and time of exam
- Duration (in minutes)
- Clock icon for time-related info

**Violations Summary:**
- Total number of incidents flagged
- Breakdown by severity:
  - Critical (red badge)
  - High (orange badge)
  - Medium (yellow badge)
  - Low (green badge)

**AI Risk Score:**
- Circular progress indicator (0-100 scale)
- Color-coded based on score:
  - 80-100: Critical Red
  - 60-79: Warning Orange
  - 40-59: Caution Yellow
  - 0-39: Success Green
- Confidence level indicator
- Risk assessment label (e.g., "High Risk", "Moderate Risk")

---

### 2. Smart Timeline

**Purpose:** Visual representation of exam duration with flagged violation markers

#### Features:

**Playback Controls:**
- Play/Pause button
- Skip backward (-30s)
- Skip forward (+30s)
- Current time / Total duration display (MM:SS format)

**Timeline Seek Bar:**
- Horizontal progress bar
- Gradient fill showing elapsed time (cyan to blue)
- Clickable/draggable to jump to specific timestamps
- Dark background with rounded corners

**Red Flag Markers:**
- Positioned along timeline based on timestamp
- Color-coded by severity
- Icon representation of violation type:
  - 📱 Phone icon for phone detection
  - 👁️ Eye icon for head-turn/gaze deviation
  - 👥 Users icon for person detection
  - 🔊 Volume icon for audio anomalies
  - ⚠️ Alert icon for tab switching
- **Hover tooltip** displaying:
  - Violation type
  - Timestamp
  - AI confidence percentage
- Scale animation on hover (1.2x)
- Click to jump to timestamp and view details

**Time Markers:**
- Evenly spaced time labels below timeline
- Shows 5 key time points (0%, 25%, 50%, 75%, 100%)

---

### 3. Evidence Matrix (Gallery)

**Purpose:** Display captured snapshots of flagged violations in a grid layout

#### Layout:
- Responsive grid (2 columns on mobile, 3 columns on desktop)
- Card-based design with hover effects
- Glassmorphic background

#### Evidence Card Components:

**Snapshot Display:**
- Aspect ratio: 16:9 video format
- Placeholder with violation type icon (actual implementation would show real frames)
- Gradient background (slate-600 to slate-700)
- Large centered icon representing violation type

**Info Overlay:**
- Timestamp (MM:SS format)
- Severity indicator dot (color-coded)
- Severity level text
- Expand icon (appears on hover)

**Severity Badge:**
- Positioned top-right corner
- Uppercase text
- Color-coded background
- Drop shadow for prominence

**Interactions:**
- Hover: Card lifts up (-4px translation)
- Border color changes to cyan on hover
- Click: Opens detailed view and updates selected flag

#### Data Storage Note:
Evidence snapshots are stored in **MinIO object storage** for scalability and efficient retrieval.

---

### 4. Action Hub

**Purpose:** Enable professors to make decisions on flagged violations

#### Decision Buttons:

**1. Confirm Cheating**
- **Color:** Red theme (#FF3B30)
- **Icon:** XCircle
- **Action:** Marks session as violation confirmed
- **Description:** "Flag as violation"
- **Visual:** Gradient background (red-500 to red-600)
- **Hover effect:** Enhanced shadow and border glow

**2. Resolve (False Positive)**
- **Color:** Green theme (#34C759)
- **Icon:** CheckCircle
- **Action:** Dismisses flags as false positive
- **Description:** "Mark as false positive"
- **Visual:** Gradient background (green-500 to green-600)
- **Hover effect:** Enhanced shadow and border glow

**3. Request Manual Review**
- **Color:** Blue theme (#007AFF)
- **Icon:** FileText
- **Action:** Escalates to admin for further review
- **Description:** "Escalate to admin"
- **Visual:** Gradient background (blue-500 to blue-600)
- **Hover effect:** Enhanced shadow and border glow

#### Selected Flag Details Panel:

Displays when a flag is clicked:
- Violation type (capitalized, formatted)
- Timestamp
- Severity level badge
- AI confidence level with animated progress bar
- Smooth entrance/exit animations

---

### 5. Audit Trail Log

**Purpose:** Maintain transparent, tamper-proof record of all system activities

#### Recent Activity Widget:

**Displayed Events:**
- Session analysis completion
- Violations flagged count
- AI processing status
- Evidence upload to MinIO
- Timestamps (relative: "2 min ago")

**Visual Design:**
- Timeline-style layout with left border accent
- Icon for each event type
- Event description and timestamp
- Scrollable if many events

#### Complete Audit Log Modal:

**Trigger:** Click "Audit Log" button in header

**Modal Design:**
- Overlay with backdrop blur
- Centered modal (max-width: 2xl)
- Dark slate background
- Header with title and description

**Log Entries:**
- Chronological order (newest first)
- Timestamp (HH:MM:SS format)
- Action description
- User/System attribution
- Left border accent line
- Monospace font for timestamps

**Sample Events:**
1. Professor review initiated
2. AI analysis completed with risk score
3. Critical violation detected
4. Evidence snapshots saved to MinIO storage
5. Person/phone/tab-switch detected
6. Exam session started

---

## Technical Implementation

### Technologies Used

- **Framework:** React with TypeScript
- **Animation:** Motion/React (Framer Motion)
- **Icons:** Lucide React
- **Styling:** Tailwind CSS v4
- **State Management:** React useState hooks

### Key Interfaces

```typescript
interface RedFlag {
  timestamp: number;
  type: 'phone' | 'head-turn' | 'person-detected' | 'audio-anomaly' | 'tab-switch';
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  snapshot?: string;
}

interface Session {
  studentId: string;
  rollNumber: string;
  examName: string;
  examDate: string;
  duration: number; // in minutes
  riskScore: number; // 0-100
  flags: RedFlag[];
  status: 'pending' | 'resolved' | 'confirmed';
}
```

### Utility Functions

**formatTime(seconds):**
- Converts seconds to MM:SS format
- Pads with zeros for consistency

**getSeverityColor(severity):**
- Maps severity levels to hex colors
- Returns: Critical (#FF3B30), High (#FF9500), Medium (#FFCC00), Low (#34C759)

**getFlagIcon(type):**
- Maps violation types to Lucide icons
- Returns: Phone, Eye, Users, Volume2, AlertTriangle, AlertCircle

**getRiskScoreColor(score):**
- Maps 0-100 score to severity colors
- 80+: Red, 60-79: Orange, 40-59: Yellow, 0-39: Green

---

## UX Principles

### 1. **Clarity Over Complexity**
- Present violation data in digestible chunks
- Use visual hierarchy to guide attention
- Progressive disclosure (show details on demand)

### 2. **Confidence Through Color**
- Consistent color coding for severity levels
- Red always means critical/danger
- Green always means safe/resolved
- Blue for neutral/informational actions

### 3. **Responsive Feedback**
- Hover states on all interactive elements
- Smooth transitions (200-300ms duration)
- Loading states for async operations
- Success/error notifications for actions

### 4. **Data Integrity**
- Immutable audit trail
- Timestamp everything
- Attribute actions to users/system
- MinIO storage references for evidence

### 5. **Accessibility**
- Sufficient color contrast (WCAG AA minimum)
- Keyboard navigation support
- Screen reader friendly labels
- Icon + text labels for clarity

---

## Integration Points

### MinIO Object Storage

**Purpose:** Store evidence snapshots and video segments

**Implementation Notes:**
- Each snapshot has unique object key
- Organized by: `session-id/timestamp-violation-type.jpg`
- Presigned URLs for secure access
- Automatic expiration for privacy compliance
- Thumbnail generation for gallery view

### AI Engine

**Purpose:** Analyze video feeds and flag violations

**Data Flow:**
1. Video feed sent to AI engine during exam
2. AI detects violations in real-time
3. Confidence scores calculated (0-100%)
4. Snapshots extracted and sent to MinIO
5. Metadata stored in database
6. Risk score aggregated from all flags

### Database Schema Considerations

**Sessions Table:**
- session_id (primary key)
- student_id
- roll_number
- exam_id
- start_time
- end_time
- duration
- risk_score
- status

**Violations Table:**
- violation_id (primary key)
- session_id (foreign key)
- timestamp
- type
- severity
- confidence
- snapshot_url (MinIO reference)
- created_at

**Audit_Log Table:**
- log_id (primary key)
- session_id (foreign key)
- timestamp
- action
- user_id
- system_component
- details (JSON)

---

## Future Enhancements

### Phase 2 Features:
- **Real-time streaming:** Live monitoring during exams
- **Multi-angle views:** Support for multiple camera feeds
- **AI model versioning:** Track which AI model flagged violations
- **Batch operations:** Bulk resolve/confirm multiple sessions
- **Advanced filtering:** Filter by severity, type, date range
- **Export capabilities:** PDF reports, CSV exports

### Phase 3 Features:
- **Student appeals portal:** Allow students to contest flags
- **Comparative analysis:** Compare student to class average
- **Heatmaps:** Visual representation of violation hotspots
- **ML model training:** Use reviewed data to improve AI
- **Integration with LMS:** Direct links to gradebook

---

## Terminology Glossary

| Term | Definition |
|------|------------|
| **Evidence Vault** | Primary interface for reviewing AI-flagged violations |
| **Red Flag / Red Dot** | Visual marker on timeline indicating violation timestamp |
| **Evidence Gallery** | Grid display of captured violation snapshots |
| **MinIO** | Object storage system for evidence snapshots and videos |
| **AI Risk Score** | Aggregate score (0-100) indicating likelihood of cheating |
| **Confidence Level** | AI's certainty percentage for a specific violation |
| **Audit Trail** | Chronological log of all system and user actions |
| **Session** | Single exam attempt by one student |
| **Violation** | Specific instance of flagged suspicious behavior |
| **Severity** | Classification of violation seriousness (low/medium/high/critical) |

---

## Verification Checklist

- [ ] All color codes match specified palette
- [ ] MinIO terminology used correctly for storage references
- [ ] Red Dots/Red Flags visible on timeline
- [ ] Evidence Gallery displays all snapshots
- [ ] Audit Trail logs all actions
- [ ] Risk score calculation implemented
- [ ] All violation types have icons
- [ ] Severity color coding consistent
- [ ] Responsive design works on mobile/desktop
- [ ] Animations smooth and performant
- [ ] Accessibility standards met
- [ ] TypeScript interfaces complete
- [ ] Mock data representative of real scenarios

---

## Support & Maintenance

**Documentation Owner:** Development Team  
**Last Updated:** January 26, 2026  
**Review Cycle:** Quarterly  
**Issue Tracking:** GitHub Issues  

For questions or clarification, contact the development team.

---

## Appendix: Design References

### Color Swatches
```css
--charcoal-bg: #121212;
--slate-dark: #1e293b;
--alert-red: #FF3B30;
--warning-orange: #FF9500;
--caution-yellow: #FFCC00;
--success-green: #34C759;
--primary-blue: #007AFF;
--cyan-accent: #06b6d4;
```

### Spacing Scale (Tailwind)
- `gap-2`: 0.5rem (8px)
- `gap-4`: 1rem (16px)
- `gap-6`: 1.5rem (24px)
- `p-4`: 1rem padding
- `p-6`: 1.5rem padding

### Border Radius
- Small elements: `rounded-lg` (8px)
- Cards: `rounded-xl` (12px)
- Large containers: `rounded-2xl` (16px)
- Circular: `rounded-full`

---

**End of Guidelines Document**
