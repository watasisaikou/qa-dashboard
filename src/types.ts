// Type definitions matching qa.py's JSON report output.

export type Severity = "HIGH" | "REVIEW" | "LOW";

export interface Finding {
  severity: Severity;
  message: string;
}

export interface NavLink {
  text: string;
  href: string;
  visible: boolean;
}

export interface VlmResult {
  items: string[];
  issues: string;
}

export interface WidthData {
  vw: number;
  scrollW: number;
  overflow: number;
  links: NavLink[];
  vlm: VlmResult | null;
  nav_screenshot: string | null;
  /** Menu toggle (named or visual) detected at this width. Absent in reports
   *  from qa.py versions before hamburger detection was added. */
  hamburger?: boolean;
  /** Toggle carries an accessible name (aria-label etc.). */
  hamburgerNamed?: boolean;
}

export interface PageReport {
  url: string;
  label: string;
  widths: Record<string, WidthData>;
  findings: Finding[];
}

export interface Summary {
  pages: number;
  HIGH: number;
  REVIEW: number;
  LOW: number;
}

export interface Report {
  widths: number[];
  vlm: boolean;
  summary: Summary;
  pages: PageReport[];
  findings: Finding[];
}
