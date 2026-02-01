# Momentum Funding Brand Identity & Design System

## Brand Identity (Contribution led by the Brand Strategist)

### Brand Essence
- **Speed:** Delivering capital in days, not weeks.
- **Accessibility:** A simple, straightforward process for everyone.
- **Reliability:** A dependable partner when it matters most.
- **Empowerment:** Providing the fuel for businesses to seize opportunities.
- **Partnership:** We succeed when our clients succeed.
- **Clarity:** Transparent terms and a jargon-free experience.
- **Resilience:** Built for the business owners who refuse to quit.

### Brand Voice
- **Tone:** Confident, reassuring, and direct. We are the calm in the storm for our clients. Our tone is professional but not cold; it’s the voice of an experienced guide who knows the path forward.
- **Language:** Clear, concise, and empathetic. We avoid complex financial jargon. We speak like a trusted advisor, using simple terms to explain how we can help. We say “working capital,” not “mezzanine financing.” We say “fast approval,” not “expedited underwriting.”
- **Communication Style:** Solution-oriented and benefit-driven. We immediately address the user’s problem (cash flow gaps, bank rejection) and present our service as the direct, actionable solution. We focus on what they will *gain*: peace of mind, the ability to make payroll, and the power to grow.

### Brand Narrative
For the builders, the grinders, and the ones who get their hands dirty—the backbone of the American economy—cash flow isn’t just a number on a spreadsheet; it’s the lifeblood of their business. Yet, traditional banks are turning their backs, leaving them stranded with slow processes and impossible standards. Momentum Funding exists to bridge that gap. We provide small and medium-sized businesses, like Michael Chen’s construction company, with fast, simple access to working capital. We believe that a good business shouldn’t fail because of a temporary cash crunch. We offer a straightforward path to the funds they need in days, not months, empowering them to make payroll, seize opportunities, and build the future they’re working so hard for.

## Design System (Contribution led by the Lead UI/UX Designer and Lead Front-End Developer)

### Color Palette

#### Primary Colors
- **Gradient Base:** The brand's identity is captured in a gradient that moves from a deep, stable blue to an energetic, vibrant teal. This represents the journey from financial stress to empowered growth.
  ```css
  linear-gradient(135deg, #0A2342 0%, #0C516E 25%, #007EA7 50%, #00A896 75%, #00D49D 100%)
  ```
- **Primary Colors (Extracted from gradient):**
  - `#0A2342` - **Midnight Blue** (Stability)
  - `#0C516E` - **Deep Sea** (Trust)
  - `#007EA7` - **Ocean Blue** (Confidence)
  - `#00A896` - **Teal** (Growth)
  - `#00D49D` - **Mint Green** (Momentum)

#### Secondary Colors
- **Dark Blue (Primary Text):** `#0A2342`
- **Medium Gray (Secondary Text):** `#5A6D7C`
- **Light Gray (Backgrounds):** `#F3F4F6`
- **White:** `#FFFFFF`
- **Black:** `#000000`

#### Functional Colors
- **Success:** `#22C55E` (Green 500)
- **Warning:** `#F59E0B` (Amber 500)
- **Error:** `#EF4444` (Red 500)
- **Info:** `#3B82F6` (Blue 500)

### Typography

#### Font Family
- **Primary Font:** **Inter**. This sans-serif font is chosen for its exceptional readability and clean, modern aesthetic. It conveys professionalism and clarity, making complex information feel accessible and trustworthy—critical for a financial service.
- **Secondary Font:** **DM Serif Display**. Used for major headlines (H1, H2), this serif font adds a touch of authority and sophistication. It creates a visual hierarchy that feels established and confident, capturing the gravity of the financial decisions our users are making.

#### Font Sizes
| Element | rem | px | Line Height |
| :--- | :--- | :--- | :--- |
| H1 | 4.5rem | 72px | 1.1 |
| H2 | 3rem | 48px | 1.2 |
| H3 | 2.25rem | 36px | 1.3 |
| H4 | 1.5rem | 24px | 1.4 |
| H5 | 1.25rem | 20px | 1.5 |
| H6 | 1rem | 16px | 1.6 |
| Body | 1rem | 16px | 1.6 |
| Body Small | 0.875rem | 14px | 1.5 |
| Body XSmall | 0.75rem | 12px | 1.4 |
| Display | 6rem | 96px | 1.0 |
| Caption | 0.75rem | 12px | 1.4 |

#### Font Weights
- Light (300)
- Regular (400)
- Medium (500)
- Semibold (600)
- Bold (700)

### UI Components

#### 21st.dev Components
- **Forms:** Input, Select, Textarea, Checkbox, Radio Group (for the application process).
- **Feedback:** Alert, Toast, Spinner (for notifications and loading states).
- **Data Display:** Table, Badge (for dashboard information).
- **Navigation:** Navbar, Breadcrumbs, Pagination.
- **Layout:** Card, Container, Grid.

#### MagicUI Components
- **Animated Number:** To dynamically display the requested loan amount as a user moves a slider.
- **Animated Shiny Text:** For primary call-to-action buttons to draw attention.
- **Testimonial Carousel:** To display success stories from other business owners like Mike.
- **Dock:** For a clean, modern navigation experience on the user dashboard.
- **Animated Gradient Text:** For major headlines to incorporate the brand gradient subtly.

#### reactbits.dev Components
- **Disclosure:** Accordion, Tabs (for FAQs and organizing dashboard content).
- **Feedback:** Skeleton (for loading states before data is fetched).
- **Forms:** Slider (for selecting loan amounts).
- **Layout:** Stack, Flex (for responsive layouts).
- **Navigation:** Link, Stepper (for the multi-step application).

#### Custom Components
- **Funding Calculator:** An interactive tool allowing users to input their desired funding amount and see an estimated repayment structure, emphasizing transparency.
- **Application Progress Tracker:** A visual stepper component that shows users exactly where they are in the application process, reducing anxiety and uncertainty.
- **Cash Flow Visualizer:** A simple dashboard widget that displays a chart of the user's recent cash flow (based on linked bank data) to reinforce the problem we solve.

### Micro-Interactions
- **Button Hover:** Subtle lift and shadow effect.
- **Form Focus:** Input border smoothly transitions to the primary brand color (Ocean Blue).
- **Loading States:** Use of skeleton screens and subtle pulsing animations.
- **Success Actions:** A quick, satisfying checkmark animation upon form submission.
- **Navigation:** A gentle slide-in effect for mobile menus.
- **Scrolling:** Parallax effects on background images and fade-in animations for content sections.

### Responsive Design (Contribution led by the Lead Front-End Developer)
- **Mobile-First Approach:** The design will be developed for mobile devices first and then scaled up to larger screens to ensure a seamless experience for all users.
- **Breakpoints:**
  - `sm`: 640px
  - `md`: 768px
  - `lg`: 1024px
  - `xl`: 1280px
  - `2xl`: 1536px
- **Mobile Adaptations:** Simplified navigation (hamburger menu), vertically stacked card layouts, larger touch targets for all interactive elements, and reduced text density.

### Accessibility
- **Color Contrast:** All text will meet WCAG AA standards for contrast against its background.
- **Keyboard Navigation:** The entire site will be fully navigable using only a keyboard.
- **Screen Reader Support:** Semantic HTML and ARIA attributes will be used to ensure compatibility with screen readers.
- **Visible Focus Indicators:** A clear, visible focus state will be present on all interactive elements.
- **Respect for Reduced Motion:** Complex animations will be disabled for users who have enabled reduced motion preferences in their system settings.

### Dark/Light Mode
Both dark and light modes will be fully supported. The system will default to the user's OS preference and provide a user-selectable toggle for manual control. Themes will be managed using DaisyUI's theming system.

## Implementation Guidelines (Contribution led by the Lead Front-End Developer)

### CSS Framework
- **Tailwind CSS:** For utility-first styling.
- **DaisyUI:** For pre-built, themeable components that accelerate development.
- **Custom Utilities:** A dedicated file for any custom utility classes not covered by Tailwind.

### Animation Library
- **Framer Motion:** For complex, state-based animations and page transitions.
- **Tailwind Animations:** For simple, class-based animations (e.g., hovers, spins).

### Icon System
- **Heroicons:** As the primary icon set for its comprehensive and clean design.
- **Custom SVGs:** For unique brand-specific icons.

### Asset Management
- **Icons:** SVG
- **Images:** WebP
- **Video:** MP4/WebM

### Code Structure
- **Component-Based Architecture:** Following React best practices.
- **Utility-First CSS:** Leveraging Tailwind for direct styling in markup.
- **Responsive Variants:** Using Tailwind's `sm:`, `md:`, etc., prefixes for responsive design.

## Design Tokens (As the Lead Front-End Developer, create a JSON object that codifies the design system's core values. Populate the JSON structure below using the values defined in the Color Palette, Typography, and common spacing/radius conventions. The structure must be exactly as follows.)

```json
{
  "colors": {
    "primary": {
      "midnight-blue": "#0A2342",
      "deep-sea": "#0C516E",
      "ocean-blue": "#007EA7",
      "teal": "#00A896",
      "mint-green": "#00D49D"
    },
    "neutral": {
      "text-primary": "#0A2342",
      "text-secondary": "#5A6D7C",
      "background": "#F3F4F6",
      "white": "#FFFFFF",
      "black": "#000000"
    },
    "functional": {
      "success": "#22C55E",
      "warning": "#F59E0B",
      "error": "#EF4444",
      "info": "#3B82F6"
    }
  },
  "typography": {
    "fontFamily": {
      "primary": "Inter, sans-serif",
      "secondary": "DM Serif Display, serif"
    }
  },
  "spacing": {
    "xs": "0.25rem",
    "sm": "0.5rem",
    "md": "1rem",
    "lg": "1.5rem",
    "xl": "2rem",
    "2xl": "3rem",
    "3xl": "4rem"
  },
  "borderRadius": {
    "sm": "0.125rem",
    "md": "0.25rem",
    "lg": "0.5rem",
    "xl": "1rem",
    "full": "9999px"
  }
}
```
}
```
