"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import {
  Bell,
  CircleHelp,
  Check,
  GripVertical,
  Inbox,
  Languages,
  LayoutDashboard,
  Layers3,
  LogOut,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Sun,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  countCards,
  moveColumn,
  moveCard,
  type Board,
  type Card,
  type Column,
} from "@/lib/board";
import {
  ApiError,
  createCard,
  deleteCard,
  getBoard,
  updateCard,
  updateColumn,
} from "@/lib/api";
import {
  localizedColumnName,
  translate,
  type Locale,
  type Theme,
  type TranslationKey,
} from "@/lib/i18n";
import AssistantChat from "./assistant-chat";

const columnDropPrefix = "column-drop:";
const sortableColumnPrefix = "sortable-column:";
const authSessionKey = "pm-authenticated-user";
const authChangeEvent = "pm-auth-change";
const localePreferenceKey = "pm-locale";
const themePreferenceKey = "pm-theme";
const preferenceChangeEvent = "pm-preference-change";

function subscribeToAuthChanges(onChange: () => void) {
  window.addEventListener(authChangeEvent, onChange);
  return () => window.removeEventListener(authChangeEvent, onChange);
}

function getAuthSnapshot() {
  return window.sessionStorage.getItem(authSessionKey) === "user";
}

function getServerAuthSnapshot(): null {
  return null;
}

function subscribeToPreferences(onChange: () => void) {
  window.addEventListener(preferenceChangeEvent, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(preferenceChangeEvent, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getLocalePreference(): Locale {
  return window.localStorage.getItem(localePreferenceKey) === "en" ? "en" : "fa";
}

function getServerLocalePreference(): Locale {
  return "fa";
}

function getThemePreference(): Theme {
  return window.localStorage.getItem(themePreferenceKey) === "dark"
    ? "dark"
    : "light";
}

function getServerThemePreference(): Theme {
  return "light";
}

function setLocalePreference(locale: Locale) {
  window.localStorage.setItem(localePreferenceKey, locale);
  window.dispatchEvent(new Event(preferenceChangeEvent));
}

function setThemePreference(theme: Theme) {
  window.localStorage.setItem(themePreferenceKey, theme);
  window.dispatchEvent(new Event(preferenceChangeEvent));
}

function getErrorMessage(
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

const boardCollisionDetection: CollisionDetection = (args) => {
  const isColumnDrag = args.active.data.current?.type === "column";
  if (isColumnDrag) {
    return closestCorners({
      ...args,
      droppableContainers: args.droppableContainers.filter(({ id }) =>
        String(id) !== String(args.active.id) &&
        String(id).startsWith(sortableColumnPrefix),
      ),
    });
  }

  const pointerCollisions = pointerWithin(args);
  const cardCollisions = pointerCollisions.filter(
    ({ id }) =>
      String(id) !== String(args.active.id) &&
      !String(id).startsWith(columnDropPrefix) &&
      !String(id).startsWith(sortableColumnPrefix),
  );
  if (cardCollisions.length > 0) return cardCollisions;

  const columnCollisions = pointerCollisions.filter(({ id }) =>
    String(id).startsWith(columnDropPrefix),
  );
  return columnCollisions.length > 0
    ? columnCollisions
    : closestCorners({
        ...args,
        droppableContainers: args.droppableContainers.filter(
          ({ id }) => !String(id).startsWith(sortableColumnPrefix),
        ),
      });
};

export default function Home() {
  const locale = useSyncExternalStore(
    subscribeToPreferences,
    getLocalePreference,
    getServerLocalePreference,
  );
  const theme = useSyncExternalStore(
    subscribeToPreferences,
    getThemePreference,
    getServerThemePreference,
  );
  const isAuthenticated = useSyncExternalStore(
    subscribeToAuthChanges,
    getAuthSnapshot,
    getServerAuthSnapshot,
  );
  const [board, setBoard] = useState<Board>([]);
  const [isLoadingBoard, setIsLoadingBoard] = useState(true);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null);
  const direction = locale === "fa" ? "rtl" : "ltr";
  const t = (key: TranslationKey) => translate(locale, key);
  const boardStyle: CSSProperties & { "--column-count": number } = {
    "--column-count": board.length,
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const activeCard = board
    .flatMap((column) => column.cards)
    .find((card) => card.id === activeCardId);
  const activeColumn = board.find((column) => column.id === activeColumnId);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
    document.documentElement.dataset.theme = theme;
    document.title = translate(locale, "documentTitle");
  }, [direction, locale, theme]);

  useEffect(() => {
    if (!isAuthenticated) return;

    let isCurrentRequest = true;
    getBoard()
      .then((loadedBoard) => {
        if (isCurrentRequest) {
          setBoard(loadedBoard);
          setBoardError(null);
        }
      })
      .catch((error: unknown) => {
        if (isCurrentRequest) {
          setBoardError(getErrorMessage(error, locale, "boardLoadError"));
        }
      })
      .finally(() => {
        if (isCurrentRequest) setIsLoadingBoard(false);
      });

    return () => {
      isCurrentRequest = false;
    };
  }, [isAuthenticated, locale]);

  async function saveBoardChange(change: () => Promise<void>) {
    setBoardError(null);
    try {
      await change();
      setBoard(await getBoard());
    } catch (error) {
      const message = getErrorMessage(error, locale, "boardSaveError");
      setBoardError(message);
      try {
        setBoard(await getBoard());
      } catch (refreshError) {
        const refreshMessage = getErrorMessage(
          refreshError,
          locale,
          "boardRefreshError",
        );
        setBoardError(`${message} ${refreshMessage}`);
      }
    }
  }

  async function retryBoardLoad() {
    setIsLoadingBoard(true);
    setBoardError(null);
    try {
      setBoard(await getBoard());
    } catch (error) {
      setBoardError(getErrorMessage(error, locale, "boardLoadError"));
    } finally {
      setIsLoadingBoard(false);
    }
  }

  function handleSignIn(username: string, password: string): boolean {
    if (username !== "user" || password !== "password") return false;

    window.sessionStorage.setItem(authSessionKey, username);
    window.dispatchEvent(new Event(authChangeEvent));
    return true;
  }

  function handleSignOut() {
    window.sessionStorage.removeItem(authSessionKey);
    setBoard([]);
    setIsLoadingBoard(true);
    setBoardError(null);
    window.dispatchEvent(new Event(authChangeEvent));
  }

  if (isAuthenticated === null) {
    return (
      <div className="auth-loading" role="status">
        {t("checkingSession")}
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <SignInScreen
        locale={locale}
        theme={theme}
        onLocaleChange={setLocalePreference}
        onThemeChange={setThemePreference}
        onSignIn={handleSignIn}
      />
    );
  }

  if (isLoadingBoard) {
    return (
      <div className="auth-loading" role="status">
        {t("loadingBoard")}
      </div>
    );
  }

  if (boardError && board.length === 0) {
    return (
      <main className="auth-loading board-load-error">
        <p role="alert">{boardError}</p>
        <button className="signin-submit" type="button" onClick={retryBoardLoad}>
          {t("retry")}
        </button>
      </main>
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveCardId(null);
    setActiveColumnId(null);
    if (!event.over) return;

    const overId = String(event.over.id);
    if (event.active.data.current?.type === "column") {
      if (overId.startsWith(sortableColumnPrefix)) {
        const columnId = String(event.active.id).slice(
          sortableColumnPrefix.length,
        );
        const targetColumnId = overId.slice(sortableColumnPrefix.length);
        const reorderedBoard = moveColumn(board, columnId, targetColumnId);
        const position = reorderedBoard.findIndex(
          (column) => column.id === columnId,
        );
        if (position >= 0 && reorderedBoard !== board) {
          void saveBoardChange(() => updateColumn(columnId, { position }));
        }
      }
      return;
    }

    const destinationColumn = board.find(
      (column) =>
        `${columnDropPrefix}${column.id}` === overId ||
        column.cards.some((card) => card.id === overId),
    );
    if (!destinationColumn) return;

    const beforeCardId = destinationColumn.cards.some(
      (card) => card.id === overId,
    )
      ? overId
      : undefined;
    const cardId = String(event.active.id);
    const reorderedBoard = moveCard(
      board,
      cardId,
      destinationColumn.id,
      beforeCardId,
    );
    const position = reorderedBoard
      .find((column) => column.id === destinationColumn.id)
      ?.cards.findIndex((card) => card.id === cardId);
    if (position !== undefined && position >= 0) {
      void saveBoardChange(() =>
        updateCard(cardId, {
          columnId: destinationColumn.id,
          position,
        }),
      );
    }
  }

  function handleAddCard(columnId: string, title: string, details: string) {
    void saveBoardChange(() => createCard(columnId, title, details));
  }

  return (
    <div className="app-shell" dir={direction}>
      <header className="topbar">
        <Link
          className="brand"
          href="/"
          aria-label={t("homeLink")}
          dir={direction}
        >
          <span className="brand-mark" aria-hidden="true">
            <Image
              className="brand-logo"
              src="/project-manager-logo.svg"
              width={34}
              height={34}
              alt=""
              priority
            />
          </span>
          <span className="brand-name">{t("appName")}</span>
        </Link>
        <div className="topbar-context" dir={direction}>
          <span>{t("workspace")}</span>
          <span className="context-divider">/</span>
          <strong>{t("studio")}</strong>
        </div>
        <div className="topbar-actions">
          <AppearanceControls
            locale={locale}
            theme={theme}
            onLocaleChange={setLocalePreference}
            onThemeChange={setThemePreference}
          />
          <span className="topbar-icon" aria-label={t("help")}>
            <CircleHelp size={17} />
          </span>
          <span className="topbar-icon" aria-label={t("notifications")}>
            <Bell size={17} />
          </span>
          <span className="workspace-avatar" aria-label={t("team")}>
            {locale === "fa" ? "ت" : "P"}
          </span>
          <button
            className="logout-button"
            type="button"
            aria-label={t("logout")}
            onClick={handleSignOut}
          >
            <LogOut size={15} />
            <span className="logout-label">{t("logout")}</span>
          </button>
        </div>
      </header>

      {boardError && (
        <p className="board-error" role="alert">
          {boardError}
        </p>
      )}

      <div className="workspace-shell" dir={direction}>
        <aside className="sidebar" dir={direction}>
          <div className="sidebar-workspace">
            <span className="sidebar-workspace-icon">
              <Layers3 size={17} />
            </span>
            <div className="sidebar-workspace-copy">
              <span className="sidebar-eyebrow">{t("workspace")}</span>
              <strong>{t("studio")}</strong>
            </div>
            <MoreHorizontal className="sidebar-more" size={18} />
          </div>

          <div className="sidebar-section-label">{t("workspaceForYou")}</div>
          <Link className="sidebar-board-link" href="#board">
            <span className="sidebar-link-icon">
              <Inbox size={17} />
            </span>
            <span>{t("sidebarBoard")}</span>
            <span className="sidebar-link-count">{countCards(board)}</span>
          </Link>

          <div className="sidebar-note">
            <div className="sidebar-note-mark">
              <LayoutDashboard size={16} />
            </div>
            <strong>{t("sidebarNoteTitle")}</strong>
            <p>{t("sidebarNoteBody")}</p>
          </div>

          <div className="sidebar-bottom">
            <span className="sidebar-bottom-dot" />
            <span>{t("sidebarFooter")}</span>
          </div>
        </aside>

        <main className="workspace-main" dir={direction} id="board">
          <div className="board-header">
            <div className="board-heading">
              <div className="board-breadcrumb">
                {t("studio")} <span>/</span> {t("boards")}
              </div>
              <h1 className="heading-title" id="page-title">
                {t("boardName")}
              </h1>
            </div>
            <div className="board-header-meta">
              <div className="member-stack" aria-label={t("members")}>
                <span className="member-avatar member-avatar-one">{locale === "fa" ? "ن" : "N"}</span>
                <span className="member-avatar member-avatar-two">{locale === "fa" ? "م" : "M"}</span>
                <span className="member-avatar member-avatar-three">{locale === "fa" ? "آ" : "A"}</span>
              </div>
              <span className="board-meta-divider" />
              <div className="board-stat">
                <span>{t("cards")}</span>
                <strong data-testid="card-count">{countCards(board)}</strong>
              </div>
              <span className="board-meta-divider" />
              <div className="board-stat">
                <span>{t("columns")}</span>
                <strong>{board.length.toLocaleString(locale === "fa" ? "fa-IR" : "en-US")}</strong>
              </div>
            </div>
          </div>

          <section className="board-canvas" aria-labelledby="board-title">
            <div className="board-toolbar">
              <div className="board-title-group">
                <span className="board-title-icon">
                  <Layers3 size={17} />
                </span>
                <span>
                  <h2 className="board-title" id="board-title">
                    {t("boardOverview")}
                  </h2>
                  <p className="board-subtitle">
                    {board.length.toLocaleString(locale === "fa" ? "fa-IR" : "en-US")} {t("stepsFromIdea")}
                  </p>
                </span>
              </div>
              <div className="board-toolbar-actions">
                <p className="drag-hint">
                  <GripVertical size={15} />
                  {t("dragHint")}
                </p>
              </div>
            </div>

            <DndContext
              id="kanban-board"
              sensors={sensors}
              collisionDetection={boardCollisionDetection}
              onDragStart={(event) => {
                if (event.active.data.current?.type === "column") {
                  setActiveColumnId(
                    String(event.active.id).slice(
                      sortableColumnPrefix.length,
                    ),
                  );
                  setActiveCardId(null);
                } else {
                  setActiveCardId(String(event.active.id));
                  setActiveColumnId(null);
                }
              }}
              onDragCancel={() => {
                setActiveCardId(null);
                setActiveColumnId(null);
              }}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={board.map(
                  (column) => `${sortableColumnPrefix}${column.id}`,
                )}
                strategy={horizontalListSortingStrategy}
              >
                <div
                  className="board-columns"
                  data-testid="board-columns"
                  style={boardStyle}
                >
                  {board.map((column) => (
                    <KanbanColumn
                      key={column.id}
                      column={column}
                      locale={locale}
                      t={t}
                      onAddCard={handleAddCard}
                      onEditCard={(cardId, title, details) =>
                        void saveBoardChange(() =>
                          updateCard(cardId, { title, details }),
                        )
                      }
                      onDeleteCard={(cardId) =>
                        void saveBoardChange(() => deleteCard(cardId))
                      }
                      onRename={(name) =>
                        void saveBoardChange(() =>
                          updateColumn(column.id, { name }),
                        )
                      }
                    />
                  ))}
                </div>
              </SortableContext>
              <DragOverlay>
                {activeCard ? (
                  <CardPreview card={activeCard} />
                ) : activeColumn ? (
                  <ColumnPreview column={activeColumn} locale={locale} />
                ) : null}
              </DragOverlay>
            </DndContext>
            <footer className="board-footer">
              <span className="board-footer-dot" />
              {t("boardFooter")}
            </footer>
          </section>
        </main>
      </div>
      <AssistantChat
        board={board}
        locale={locale}
        onBoardUpdated={setBoard}
      />
    </div>
  );
}

function AppearanceControls({
  locale,
  theme,
  onLocaleChange,
  onThemeChange,
}: {
  locale: Locale;
  theme: Theme;
  onLocaleChange: (locale: Locale) => void;
  onThemeChange: (theme: Theme) => void;
}) {
  const t = (key: TranslationKey) => translate(locale, key);

  return (
    <div
      className="appearance-controls"
      dir={locale === "fa" ? "rtl" : "ltr"}
    >
      <button
        className="appearance-button language-button"
        type="button"
        aria-label={locale === "fa" ? t("switchToEnglish") : t("switchToPersian")}
        title={locale === "fa" ? t("switchToEnglish") : t("switchToPersian")}
        data-testid="locale-toggle"
        onClick={() => onLocaleChange(locale === "fa" ? "en" : "fa")}
      >
        <Languages size={15} />
        <span>{locale === "fa" ? "EN" : "فا"}</span>
      </button>
      <button
        className="appearance-button theme-button"
        type="button"
        aria-label={theme === "light" ? t("switchToDark") : t("switchToLight")}
        title={theme === "light" ? t("switchToDark") : t("switchToLight")}
        aria-pressed={theme === "dark"}
        data-testid="theme-toggle"
        onClick={() => onThemeChange(theme === "light" ? "dark" : "light")}
      >
        {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
        <span>{theme === "light" ? t("darkMode") : t("lightMode")}</span>
      </button>
    </div>
  );
}

function SignInScreen({
  locale,
  theme,
  onLocaleChange,
  onThemeChange,
  onSignIn,
}: {
  locale: Locale;
  theme: Theme;
  onLocaleChange: (locale: Locale) => void;
  onThemeChange: (theme: Theme) => void;
  onSignIn: (username: string, password: string) => boolean;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [hasError, setHasError] = useState(false);
  const t = (key: TranslationKey) => translate(locale, key);
  const direction = locale === "fa" ? "rtl" : "ltr";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onSignIn(username, password)) setHasError(true);
  }

  return (
    <main className="signin-screen" dir={direction}>
      <div className="signin-preferences">
        <AppearanceControls
          locale={locale}
          theme={theme}
          onLocaleChange={onLocaleChange}
          onThemeChange={onThemeChange}
        />
      </div>
      <form className="signin-card" onSubmit={handleSubmit}>
        <div className="signin-brand">
          <Image
            className="brand-logo"
            src="/project-manager-logo.svg"
            width={40}
            height={40}
            alt=""
          />
          <span className="brand-name">{t("appName")}</span>
        </div>
        <h1 className="signin-title">{t("loginTitle")}</h1>
        <p className="signin-description">{t("loginDescription")}</p>
        <label className="signin-label" htmlFor="username">
          {t("username")}
        </label>
        <input
          id="username"
          className="signin-input"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
        />
        <label className="signin-label" htmlFor="password">
          {t("password")}
        </label>
        <input
          id="password"
          className="signin-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        {hasError && (
          <p className="signin-error" role="alert">
            {t("invalidCredentials")}
          </p>
        )}
        <button className="signin-submit" type="submit">
          {t("login")}
        </button>
      </form>
    </main>
  );
}

interface KanbanColumnProps {
  column: Column;
  locale: Locale;
  t: (key: TranslationKey) => string;
  onAddCard: (columnId: string, title: string, details: string) => void;
  onEditCard: (cardId: string, title: string, details: string) => void;
  onDeleteCard: (cardId: string) => void;
  onRename: (name: string) => void;
}

function KanbanColumn({
  column,
  locale,
  t,
  onAddCard,
  onEditCard,
  onDeleteCard,
  onRename,
}: KanbanColumnProps) {
  const displayName = localizedColumnName(column.name, locale);
  const {
    attributes,
    listeners,
    setNodeRef: setSortableNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `${sortableColumnPrefix}${column.id}`,
    data: { type: "column" },
  });
  const { isOver, setNodeRef } = useDroppable({
    id: `${columnDropPrefix}${column.id}`,
  });
  const [isAddingCard, setIsAddingCard] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(column.name);

  function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = nameDraft.trim();
    if (trimmedName) onRename(trimmedName);
    setIsEditingName(false);
  }

  function handleNameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setNameDraft(column.name);
      setIsEditingName(false);
    }
  }

  return (
    <section
      className={`kanban-column${isOver ? " is-over" : ""}${isDragging ? " is-column-dragging" : ""}`}
      ref={setSortableNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      data-testid={`kanban-column-${column.id}`}
      aria-labelledby={`column-heading-${column.id}`}
    >
      <header className="column-header">
        <button
          className="icon-button column-drag-handle"
          type="button"
          aria-label={`${t("moveColumn")} ${displayName}`}
          data-testid="column-drag-handle"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={15} />
        </button>
        <div className="column-name-wrap">
          <span className="column-color" />
          {isEditingName ? (
            <form
              className="column-name-form"
              onSubmit={(event) => {
                saveName(event);
              }}
            >
              <input
                aria-label={t("columnName")}
                className="column-name-input"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onKeyDown={handleNameKeyDown}
                autoFocus
              />
            </form>
          ) : (
            <h3 className="column-name" id={`column-heading-${column.id}`}>
              {displayName}
            </h3>
          )}
        </div>
        <span
          className="column-count"
          aria-label={`${column.cards.length} ${t("cardCount")}`}
        >
          {column.cards.length}
        </span>
        <button
          className="icon-button"
          type="button"
          aria-label={`${t("renameColumn")} ${displayName}`}
          title={t("renameColumn")}
          onClick={() => {
            setNameDraft(displayName);
            setIsEditingName(true);
          }}
        >
          <Pencil size={14} />
        </button>
      </header>

      <SortableContext
        items={column.cards.map((card) => card.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          className="card-list"
          ref={setNodeRef}
          data-column-id={column.id}
          data-testid="card-list"
        >
          {column.cards.map((card) => (
            <SortableCard
              key={card.id}
              card={card}
              t={t}
              onEdit={(title, details) =>
                onEditCard(card.id, title, details)
              }
              onDelete={() => onDeleteCard(card.id)}
            />
          ))}
          {column.cards.length === 0 && (
            <p className="empty-column">{t("emptyColumn")}</p>
          )}
        </div>
      </SortableContext>

      {isAddingCard ? (
        <AddCardForm
          t={t}
          onSubmit={(title, details) => {
            onAddCard(column.id, title, details);
            setIsAddingCard(false);
          }}
          onCancel={() => setIsAddingCard(false)}
        />
      ) : (
        <button
          className="add-card-button"
          type="button"
          aria-label={`${t("addCardTo")} ${displayName}`}
          onClick={() => setIsAddingCard(true)}
        >
          <Plus size={15} />
          {t("addCard")}
        </button>
      )}
    </section>
  );
}

interface AddCardFormProps {
  t: (key: TranslationKey) => string;
  onSubmit: (title: string, details: string) => void;
  onCancel: () => void;
}

function AddCardForm({ t, onSubmit, onCancel }: AddCardFormProps) {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    onSubmit(trimmedTitle, details.trim());
  }

  return (
    <form className="add-card-form" onSubmit={handleSubmit}>
      <input
        aria-label={t("cardTitle")}
        className="form-field"
        placeholder={t("cardTitle")}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        required
        autoFocus
      />
      <textarea
        aria-label={t("cardDetails")}
        className="form-field details-field"
        placeholder={t("details")}
        value={details}
        onChange={(event) => setDetails(event.target.value)}
      />
      <div className="form-actions">
        <button className="submit-button" type="submit">
          <Check size={14} />
          {t("submitCard")}
        </button>
        <button className="cancel-button" type="button" onClick={onCancel}>
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}

interface SortableCardProps {
  card: Card;
  t: (key: TranslationKey) => string;
  onEdit: (title: string, details: string) => void;
  onDelete: () => void;
}

function SortableCard({ card, t, onEdit, onDelete }: SortableCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.id,
    transition: {
      duration: 280,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    },
  });

  return (
    <article
      className={`task-card${isDragging ? " is-dragging" : ""}`}
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      data-testid={`kanban-card-${card.id}`}
    >
      {isEditing ? (
        <EditCardForm
          card={card}
          t={t}
          onSubmit={(title, details) => {
            onEdit(title, details);
            setIsEditing(false);
          }}
          onCancel={() => setIsEditing(false)}
        />
      ) : (
        <>
          <div className="card-actions">
            <button
              className="icon-button drag-handle"
              type="button"
              aria-label={`${t("moveCard")} ${card.title}`}
              data-testid="drag-handle"
              {...attributes}
              {...listeners}
            >
              <GripVertical size={16} />
            </button>
            <span>
              <button
                className="icon-button"
                type="button"
                aria-label={`${t("editCard")} ${card.title}`}
                title={t("editCard")}
                onClick={() => setIsEditing(true)}
              >
                <Pencil size={14} />
              </button>
              <button
                className="icon-button delete-button"
                type="button"
                aria-label={`${t("deleteCard")} ${card.title}`}
                title={t("deleteCard")}
                onClick={onDelete}
              >
                <Trash2 size={14} />
              </button>
            </span>
          </div>
          <h4 className="card-title">{card.title}</h4>
          {card.details && <p className="card-details">{card.details}</p>}
        </>
      )}
    </article>
  );
}

function EditCardForm({
  card,
  t,
  onSubmit,
  onCancel,
}: {
  card: Card;
  t: (key: TranslationKey) => string;
  onSubmit: (title: string, details: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [details, setDetails] = useState(card.details);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (trimmedTitle) onSubmit(trimmedTitle, details.trim());
  }

  return (
    <form className="add-card-form" onSubmit={handleSubmit}>
      <input
        aria-label={t("cardTitle")}
        className="form-field"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        required
        autoFocus
      />
      <textarea
        aria-label={t("cardDetails")}
        className="form-field details-field"
        value={details}
        onChange={(event) => setDetails(event.target.value)}
      />
      <div className="form-actions">
        <button className="submit-button" type="submit">
          <Check size={14} />
          {t("saveChanges")}
        </button>
        <button className="cancel-button" type="button" onClick={onCancel}>
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}

function CardPreview({ card }: { card: Card }) {
  return (
    <article className="task-card drag-overlay" aria-hidden="true">
      <h4 className="card-title">{card.title}</h4>
      {card.details && <p className="card-details">{card.details}</p>}
    </article>
  );
}

function ColumnPreview({
  column,
  locale,
}: {
  column: Column;
  locale: Locale;
}) {
  return (
    <section className="kanban-column drag-column-overlay" aria-hidden="true">
      <header className="column-header">
        <h3 className="column-name">
          {localizedColumnName(column.name, locale)}
        </h3>
        <span className="column-count">{column.cards.length}</span>
      </header>
      <div className="card-list">
        {column.cards.map((card) => (
          <article className="task-card" key={card.id}>
            <h4 className="card-title">{card.title}</h4>
          </article>
        ))}
      </div>
    </section>
  );
}
