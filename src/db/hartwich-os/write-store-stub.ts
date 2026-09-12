import type {
  HartwichWriteStore,
  PersistDiscoveredCompanyInput,
  PersistDiscoveredCompanyResult,
  CreateEmailDraftInput,
  CreateEmailDraftResult,
  RecordOutboundEmailInput,
  RecordOutboundEmailResult,
  RecordInboundReplyInput,
  RecordInboundReplyResult,
  CreateTaskInput,
  CreateTaskResult,
} from "./write-store.js";

/**
 * Every method throws "not implemented" by default — demos and tests
 * extend this and override only the methods they actually exercise,
 * instead of hand-writing a stub for every HartwichWriteStore method each
 * time the interface grows a new one (every phase so far has added at
 * least one).
 */
export class NotImplementedWriteStore implements HartwichWriteStore {
  async persistDiscoveredCompany(_input: PersistDiscoveredCompanyInput): Promise<PersistDiscoveredCompanyResult> {
    throw new Error("persistDiscoveredCompany: not implemented by this fake");
  }
  async createEmailDraft(_input: CreateEmailDraftInput): Promise<CreateEmailDraftResult> {
    throw new Error("createEmailDraft: not implemented by this fake");
  }
  async recordOutboundEmail(_input: RecordOutboundEmailInput): Promise<RecordOutboundEmailResult> {
    throw new Error("recordOutboundEmail: not implemented by this fake");
  }
  async recordInboundReply(_input: RecordInboundReplyInput): Promise<RecordInboundReplyResult> {
    throw new Error("recordInboundReply: not implemented by this fake");
  }
  async moveDealToLostStage(_dealId: string): Promise<void> {
    throw new Error("moveDealToLostStage: not implemented by this fake");
  }
  async flagDealForReview(_dealId: string): Promise<void> {
    throw new Error("flagDealForReview: not implemented by this fake");
  }
  async createTask(_input: CreateTaskInput): Promise<CreateTaskResult> {
    throw new Error("createTask: not implemented by this fake");
  }
  async appendCompanyNote(_companyId: string, _note: string): Promise<void> {
    throw new Error("appendCompanyNote: not implemented by this fake");
  }
}
