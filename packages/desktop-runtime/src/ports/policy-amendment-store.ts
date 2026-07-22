import type {
  RuntimeExecPolicyAmendment,
  RuntimeNetworkApprovalProtocol,
  RuntimeNetworkPolicyAmendment,
} from '@setsuna-desktop/contracts';

export type RuntimePolicyAmendments = {
  execPolicyAmendments: RuntimeExecPolicyAmendment[];
  networkPolicyAmendments: RuntimeNetworkPolicyAmendment[];
};

export type PolicyAmendmentStore = {
  listPolicyAmendments(): Promise<RuntimePolicyAmendments>;
  appendExecPolicyAmendment(amendment: RuntimeExecPolicyAmendment): Promise<void>;
  appendNetworkPolicyAmendment(amendment: RuntimeNetworkPolicyAmendment, protocol?: RuntimeNetworkApprovalProtocol): Promise<void>;
};
