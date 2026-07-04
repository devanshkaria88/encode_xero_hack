"use client";

import * as React from "react";

import type { CardProps } from "./use-resolve";
import { ProvideTranscriptCard } from "./provide-transcript-card";
import { ConfirmClientCard } from "./confirm-client-card";
import { ReviewInvoiceCard } from "./review-invoice-card";
import { ConfirmAgreementCard } from "./confirm-agreement-card";
import { AttachContractCard } from "./attach-contract-card";

/** Route a task to its resolvable card by type. */
export function TaskRouter(props: CardProps) {
  switch (props.task.type) {
    case "PROVIDE_TRANSCRIPT":
      return <ProvideTranscriptCard {...props} />;
    case "CONFIRM_CLIENT_MATCH":
      return <ConfirmClientCard {...props} />;
    case "REVIEW_INVOICE":
      return <ReviewInvoiceCard {...props} />;
    case "CONFIRM_AGREEMENT":
      return <ConfirmAgreementCard {...props} />;
    case "ATTACH_CONTRACT":
      return <AttachContractCard {...props} />;
    default:
      return null;
  }
}
