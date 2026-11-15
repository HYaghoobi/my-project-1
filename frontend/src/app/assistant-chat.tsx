"use client";

import { Bot, Check, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Board } from "@/lib/board";
import {
  ApiError,
  applyChatProposal,
  getChatHistory,
  rejectChatProposal,
  sendChatMessage,
  type ChatMessage,
  type ChatOperation,
  type ChatProposal,
} from "@/lib/api";
import {
  localizedColumnName,
  translate,
  type Locale,
  type TranslationKey,
} from "@/lib/i18n";

interface AssistantChatProps {
  board: Board;
  locale: Locale;
  onBoardUpdated: (board: Board) => void;
}

function getChatError(
  error: unknown,
  locale: Locale,
  fallbackKey: TranslationKey,
): string {
  if (error instanceof ApiError) {
    return `${translate(locale, "serverRequestFailed")} (${error.status}).`;
  }
  return error instanceof Error
    ? error.message
    : translate(locale, fallbackKey);
}

function operationDescription(
  operation: ChatOperation,
  board: Board,
  locale: Locale,
): string {
  const columnName = (columnId: number) => {
    const column = board.find((item) => Number(item.id) === columnId);
    return localizedColumnName(column?.name ?? String(columnId), locale);
  };
  const cardTitle = (cardId: number) =>
    board
      .flatMap((column) => column.cards)
      .find((card) => Number(card.id) === cardId)?.title ?? String(cardId);

  if (operation.type === "create_card") {
    return translate(locale, "assistantCreateCard")
      .replace("{title}", operation.title)
      .replace("{column}", columnName(operation.column_id));
  }
  if (operation.type === "update_card") {
    const originalTitle = cardTitle(operation.card_id);
    if (operation.title) {
      return translate(locale, "assistantRenameCard")
        .replace("{title}", originalTitle)
        .replace("{newTitle}", operation.title);
    }
    return translate(locale, "assistantUpdateCard").replace(
      "{title}",
      originalTitle,
    );
  }
  return translate(locale, "assistantMoveCard")
    .replace("{title}", cardTitle(operation.card_id))
    .replace("{column}", columnName(operation.column_id));
}

export default function AssistantChat({
  board,
  locale,
  onBoardUpdated,
}: AssistantChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [workingProposalId, setWorkingProposalId] = useState<number | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const nextLocalId = useRef(0);
  const t = (key: TranslationKey) => translate(locale, key);

  useEffect(() => {
    let isCurrentRequest = true;
    getChatHistory()
      .then((history) => {
        if (isCurrentRequest) {
          setMessages(history);
          setError(null);
        }
      })
      .catch((historyError: unknown) => {
        if (isCurrentRequest) {
          setError(
            getChatError(historyError, locale, "assistantHistoryError"),
          );
        }
      })
      .finally(() => {
        if (isCurrentRequest) setIsLoadingHistory(false);
      });

    return () => {
      isCurrentRequest = false;
    };
  }, [locale]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || isSending) return;

    setError(null);
    setDraft("");
    setIsSending(true);
    setMessages((current) => [
      ...current,
      { id: -(++nextLocalId.current), role: "user", content: message },
    ]);

    try {
      const reply = await sendChatMessage(message);
      setMessages((current) => [
        ...current,
        {
          id: -(++nextLocalId.current),
          role: "assistant",
          content: reply.message,
          proposal: reply.proposal,
        },
      ]);
    } catch (sendError) {
      setDraft(message);
      setError(getChatError(sendError, locale, "assistantReplyError"));
    } finally {
      setIsSending(false);
    }
  }

  async function handleProposalAction(
    proposal: ChatProposal,
    action: "apply" | "reject",
  ) {
    setError(null);
    setWorkingProposalId(proposal.id);
    try {
      if (action === "apply") {
        onBoardUpdated(await applyChatProposal(proposal.id));
        setMessages((current) =>
          current.map((message) =>
            message.proposal?.id === proposal.id
              ? {
                  ...message,
                  proposal: { ...message.proposal, status: "applied" },
                }
              : message,
          ),
        );
      } else {
        const rejectedProposal = await rejectChatProposal(proposal.id);
        setMessages((current) =>
          current.map((message) =>
            message.proposal?.id === proposal.id
              ? { ...message, proposal: rejectedProposal }
              : message,
          ),
        );
      }
    } catch (actionError) {
      setError(getChatError(actionError, locale, "assistantActionError"));
    } finally {
      setWorkingProposalId(null);
    }
  }

  return (
    <div className="assistant-widget" dir={locale === "fa" ? "rtl" : "ltr"}>
      {isOpen && (
        <section
          className="assistant-panel"
          role="dialog"
          aria-label={t("assistantTitle")}
          data-testid="assistant-panel"
        >
          <header className="assistant-header">
            <span className="assistant-avatar" aria-hidden="true">
              <Bot size={19} />
            </span>
            <span className="assistant-header-copy">
              <strong>{t("assistantTitle")}</strong>
              <span>{t("assistantHint")}</span>
            </span>
            <button
              className="assistant-close"
              type="button"
              aria-label={t("assistantClose")}
              onClick={() => setIsOpen(false)}
            >
              <X size={18} />
            </button>
          </header>

          <div className="assistant-messages" role="log" aria-live="polite">
            {isLoadingHistory ? (
              <p className="assistant-empty" role="status">
                {t("assistantHistoryLoading")}
              </p>
            ) : messages.length === 0 ? (
              <div className="assistant-empty">
                <Sparkles size={18} aria-hidden="true" />
                <p>{t("assistantWelcome")}</p>
              </div>
            ) : (
              messages.map((message) => (
                <article
                  className={`assistant-message assistant-message-${message.role}`}
                  key={message.id}
                >
                  <p>{message.content}</p>
                  {message.proposal && (
                    <ProposalCard
                      proposal={message.proposal}
                      board={board}
                      locale={locale}
                      working={workingProposalId === message.proposal.id}
                      onAction={handleProposalAction}
                    />
                  )}
                </article>
              ))
            )}
          </div>

          {error && (
            <p className="assistant-error" role="alert">
              {error}
            </p>
          )}

          {isSending && (
            <p className="assistant-status" role="status">
              {t("assistantSending")}
            </p>
          )}

          <form className="assistant-form" onSubmit={handleSubmit}>
            <textarea
              aria-label={t("assistantPlaceholder")}
              placeholder={t("assistantPlaceholder")}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={2}
            />
            <button
              className="assistant-send"
              type="submit"
              aria-label={t("assistantSend")}
              disabled={!draft.trim() || isSending}
            >
              <Send size={17} />
            </button>
          </form>
        </section>
      )}

      <button
        className="assistant-launcher"
        type="button"
        aria-label={isOpen ? t("assistantClose") : t("assistantOpen")}
        aria-expanded={isOpen}
        data-testid="assistant-launcher"
        onClick={() => setIsOpen((open) => !open)}
      >
        {isOpen ? <X size={21} /> : <MessageCircle size={22} />}
        {!isOpen && <span>{t("assistantTitle")}</span>}
      </button>
    </div>
  );
}

function ProposalCard({
  proposal,
  board,
  locale,
  working,
  onAction,
}: {
  proposal: ChatProposal;
  board: Board;
  locale: Locale;
  working: boolean;
  onAction: (
    proposal: ChatProposal,
    action: "apply" | "reject",
  ) => Promise<void>;
}) {
  const t = (key: TranslationKey) => translate(locale, key);
  const statusLabel =
    proposal.status === "applied"
      ? t("assistantApplied")
      : proposal.status === "rejected"
        ? t("assistantRejected")
        : t("assistantPending");

  return (
    <section className="assistant-proposal" aria-label={t("assistantProposalTitle")}>
      <strong>{t("assistantProposalTitle")}</strong>
      <ul>
        {proposal.operations.map((operation, index) => (
          <li key={`${proposal.id}-${index}`}>
            {operationDescription(operation, board, locale)}
          </li>
        ))}
      </ul>
      {proposal.status === "pending" ? (
        <>
          <p>{t("assistantProposalNotice")}</p>
          <div className="assistant-proposal-actions">
            <button
              type="button"
              className="assistant-approve"
              disabled={working}
              onClick={() => void onAction(proposal, "apply")}
            >
              <Check size={14} />
              {working ? t("assistantApplying") : t("assistantApply")}
            </button>
            <button
              type="button"
              className="assistant-reject"
              disabled={working}
              onClick={() => void onAction(proposal, "reject")}
            >
              {working ? t("assistantRejecting") : t("assistantReject")}
            </button>
          </div>
        </>
      ) : (
        <p className="assistant-proposal-status" role="status">
          {statusLabel}
        </p>
      )}
    </section>
  );
}
