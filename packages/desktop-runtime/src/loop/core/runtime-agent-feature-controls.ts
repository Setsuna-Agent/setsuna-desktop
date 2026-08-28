import {
  createNoopApprovalReviewControl,
  type ApprovalReviewControl,
} from '@setsuna-desktop/feature-approval-review/contracts';
import {
  createNoopCollaborationControl,
  type CollaborationControl,
} from '@setsuna-desktop/feature-collaboration/contracts';
import {
  createNoopGoalControl,
  type GoalControl,
} from '@setsuna-desktop/feature-goal/contracts';
import {
  createNoopMemoryControl,
  type MemoryControl,
} from '@setsuna-desktop/feature-memory/contracts';
import {
  createNoopThreadTitleGenerationControl,
  type ThreadTitleGenerationControl,
} from '@setsuna-desktop/feature-thread-title-generation/contracts';

/** Owns late-bound optional Feature controls and restores no-op fallbacks on disposal. */
export class RuntimeAgentFeatureControls {
  approvalReviews: ApprovalReviewControl = createNoopApprovalReviewControl();
  collaboration: CollaborationControl = createNoopCollaborationControl();
  goals: GoalControl = createNoopGoalControl();
  memory: MemoryControl = createNoopMemoryControl();
  threadTitles: ThreadTitleGenerationControl = createNoopThreadTitleGenerationControl();

  bindApprovalReview(control: ApprovalReviewControl): () => void {
    if (this.approvalReviews.available && this.approvalReviews !== control) {
      throw new Error('Approval review control is already bound.');
    }
    this.approvalReviews = control;
    return () => {
      if (this.approvalReviews === control) this.approvalReviews = createNoopApprovalReviewControl();
    };
  }

  bindCollaboration(control: CollaborationControl): () => void {
    if (this.collaboration.available && this.collaboration !== control) {
      throw new Error('Collaboration control is already bound.');
    }
    this.collaboration = control;
    return () => {
      if (this.collaboration === control) this.collaboration = createNoopCollaborationControl();
    };
  }

  bindGoal(control: GoalControl): () => void {
    if (this.goals.available && this.goals !== control) {
      throw new Error('Goal control is already bound.');
    }
    this.goals = control;
    return () => { if (this.goals === control) this.goals = createNoopGoalControl(); };
  }

  bindMemory(control: MemoryControl): () => void {
    if (this.memory.available && this.memory !== control) {
      throw new Error('Memory control is already bound.');
    }
    this.memory = control;
    return () => { if (this.memory === control) this.memory = createNoopMemoryControl(); };
  }

  bindThreadTitles(control: ThreadTitleGenerationControl): () => void {
    if (this.threadTitles.available && this.threadTitles !== control) {
      throw new Error('Thread title generation control is already bound.');
    }
    this.threadTitles = control;
    return () => {
      if (this.threadTitles === control) this.threadTitles = createNoopThreadTitleGenerationControl();
    };
  }
}
