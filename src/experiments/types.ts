/**
 * Experiment Engine types (SPEC.md §34). Scoped deliberately narrow for
 * Phase 4: define variants and assign prospects to them deterministically.
 * Measuring outcomes per variant (reply rate, meeting rate, close rate)
 * needs real sent-message data that doesn't exist until Phase 5/8 — this
 * is the "define and assign" half, not the "measure and conclude" half.
 */

export type ExperimentVariant = {
  id: string;
  name: string;
  /** What makes this variant distinct — passed to Outreach Strategy as `experimentDirective`. */
  directive: string;
  /** Relative weight for assignment — equal weights by default, need not sum to any particular total. */
  weight: number;
};

export type ExperimentStatus = "running" | "stopped" | "concluded";

export type Experiment = {
  id: string;
  name: string;
  description: string;
  variants: ExperimentVariant[];
  /** SPEC.md §34: "require sufficient sample size" before anything draws a conclusion from this experiment. */
  minSampleSizePerVariant: number;
  status: ExperimentStatus;
  createdAt: Date;
};
