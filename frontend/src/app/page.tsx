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
  LayoutDashboard,
  Layers3,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import {
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  addCard,
  countCards,
  deleteCard,
  editCard,
  initialBoard,
  moveColumn,
  moveCard,
  renameColumn,
  type Board,
  type Card,
  type Column,
} from "@/lib/board";

const columnDropPrefix = "column-drop:";
const sortableColumnPrefix = "sortable-column:";
const authSessionKey = "pm-authenticated-user";
const authChangeEvent = "pm-auth-change";

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
  const isAuthenticated = useSyncExternalStore(
    subscribeToAuthChanges,
    getAuthSnapshot,
    getServerAuthSnapshot,
  );
  const [board, setBoard] = useState<Board>(initialBoard);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null);
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

  function handleSignIn(username: string, password: string): boolean {
    if (username !== "user" || password !== "password") return false;

    window.sessionStorage.setItem(authSessionKey, username);
    window.dispatchEvent(new Event(authChangeEvent));
    return true;
  }

  function handleSignOut() {
    window.sessionStorage.removeItem(authSessionKey);
    window.dispatchEvent(new Event(authChangeEvent));
  }

  if (isAuthenticated === null) {
    return (
      <div className="auth-loading" role="status">
        در حال بررسی نشست...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <SignInScreen onSignIn={handleSignIn} />;
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveCardId(null);
    setActiveColumnId(null);
    if (!event.over) return;

    const overId = String(event.over.id);
    if (event.active.data.current?.type === "column") {
      if (overId.startsWith(sortableColumnPrefix)) {
        setBoard((currentBoard) =>
          moveColumn(
            currentBoard,
            String(event.active.id).slice(sortableColumnPrefix.length),
            overId.slice(sortableColumnPrefix.length),
          ),
        );
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
    setBoard((currentBoard) =>
      moveCard(
        currentBoard,
        String(event.active.id),
        destinationColumn.id,
        beforeCardId,
      ),
    );
  }

  function handleAddCard(columnId: string, title: string, details: string) {
    setBoard((currentBoard) =>
      addCard(currentBoard, columnId, {
        id: crypto.randomUUID(),
        title,
        details,
      }),
    );
  }

  return (
    <div className="app-shell" dir="ltr">
      <header className="topbar">
        <Link
          className="brand"
          href="/"
          aria-label="مدیر پروژه، صفحهٔ اصلی"
          dir="rtl"
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
          <span className="brand-name">مدیر پروژه</span>
        </Link>
        <div className="topbar-context" dir="rtl">
          <span>فضای کاری</span>
          <span className="context-divider">/</span>
          <strong>استودیو محصول</strong>
        </div>
        <div className="topbar-actions">
          <span className="topbar-icon" aria-label="راهنما">
            <CircleHelp size={17} />
          </span>
          <span className="topbar-icon" aria-label="اعلان‌ها">
            <Bell size={17} />
          </span>
          <span className="workspace-avatar" aria-label="تیم محصول">
            ت
          </span>
          <button
            className="logout-button"
            type="button"
            aria-label="خروج"
            onClick={handleSignOut}
          >
            <LogOut size={15} />
            <span className="logout-label">خروج</span>
          </button>
        </div>
      </header>

      <div className="workspace-shell">
        <aside className="sidebar" dir="rtl">
          <div className="sidebar-workspace">
            <span className="sidebar-workspace-icon">
              <Layers3 size={17} />
            </span>
            <div className="sidebar-workspace-copy">
              <span className="sidebar-eyebrow">فضای کاری</span>
              <strong>استودیو محصول</strong>
            </div>
            <MoreHorizontal className="sidebar-more" size={18} />
          </div>

          <div className="sidebar-section-label">فضای کاری شما</div>
          <Link className="sidebar-board-link" href="#board">
            <span className="sidebar-link-icon">
              <Inbox size={17} />
            </span>
            <span>تختهٔ تیم محصول</span>
            <span className="sidebar-link-count">{countCards(board)}</span>
          </Link>

          <div className="sidebar-note">
            <div className="sidebar-note-mark">
              <LayoutDashboard size={16} />
            </div>
            <strong>قدم بعدی، همین‌جاست</strong>
            <p>کارت‌ها را بین ستون‌ها جابه‌جا کنید و پیشرفت تیم را ببینید.</p>
          </div>

          <div className="sidebar-bottom">
            <span className="sidebar-bottom-dot" />
            <span>یک تخته، مسیر پیشرفت</span>
          </div>
        </aside>

        <main className="workspace-main" dir="rtl" id="board">
          <div className="board-header">
            <div className="board-heading">
              <div className="board-breadcrumb">
                استودیو محصول <span>/</span> تخته‌ها
              </div>
              <h1 className="heading-title" id="page-title">
                تختهٔ تیم محصول
              </h1>
            </div>
            <div className="board-header-meta">
              <div className="member-stack" aria-label="اعضای تیم">
                <span className="member-avatar member-avatar-one">ن</span>
                <span className="member-avatar member-avatar-two">م</span>
                <span className="member-avatar member-avatar-three">آ</span>
              </div>
              <span className="board-meta-divider" />
              <div className="board-stat">
                <span>کارت‌ها</span>
                <strong data-testid="card-count">{countCards(board)}</strong>
              </div>
              <span className="board-meta-divider" />
              <div className="board-stat">
                <span>ستون‌ها</span>
                <strong>{board.length.toLocaleString("fa-IR")}</strong>
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
                    نمای کلی کارها
                  </h2>
                  <p className="board-subtitle">
                    {board.length.toLocaleString("fa-IR")} مرحله از ایده تا اجرا
                  </p>
                </span>
              </div>
              <div className="board-toolbar-actions">
                <p className="drag-hint">
                  <GripVertical size={15} />
                  برای جابه‌جایی، کارت یا ستون را بکشید
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
                      onAddCard={handleAddCard}
                      onEditCard={(cardId, title, details) =>
                        setBoard((currentBoard) =>
                          editCard(currentBoard, cardId, title, details),
                        )
                      }
                      onDeleteCard={(cardId) =>
                        setBoard((currentBoard) =>
                          deleteCard(currentBoard, cardId),
                        )
                      }
                      onRename={(name) =>
                        setBoard((currentBoard) =>
                          renameColumn(currentBoard, column.id, name),
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
                  <ColumnPreview column={activeColumn} />
                ) : null}
              </DragOverlay>
            </DndContext>
            <footer className="board-footer">
              <span className="board-footer-dot" />
              همه‌چیز با یک قدم کوچک شروع می‌شود.
            </footer>
          </section>
        </main>
      </div>
    </div>
  );
}

function SignInScreen({
  onSignIn,
}: {
  onSignIn: (username: string, password: string) => boolean;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [hasError, setHasError] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onSignIn(username, password)) setHasError(true);
  }

  return (
    <main className="signin-screen" dir="rtl">
      <form className="signin-card" onSubmit={handleSubmit}>
        <div className="signin-brand">
          <Image
            className="brand-logo"
            src="/project-manager-logo.svg"
            width={40}
            height={40}
            alt=""
          />
          <span className="brand-name">مدیر پروژه</span>
        </div>
        <h1 className="signin-title">ورود به حساب کاربری</h1>
        <p className="signin-description">
          برای مشاهدهٔ تختهٔ کانبان، وارد شوید.
        </p>
        <label className="signin-label" htmlFor="username">
          نام کاربری
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
          رمز عبور
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
            نام کاربری یا رمز عبور نادرست است.
          </p>
        )}
        <button className="signin-submit" type="submit">
          ورود
        </button>
      </form>
    </main>
  );
}

interface KanbanColumnProps {
  column: Column;
  onAddCard: (columnId: string, title: string, details: string) => void;
  onEditCard: (cardId: string, title: string, details: string) => void;
  onDeleteCard: (cardId: string) => void;
  onRename: (name: string) => void;
}

function KanbanColumn({
  column,
  onAddCard,
  onEditCard,
  onDeleteCard,
  onRename,
}: KanbanColumnProps) {
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
    onRename(nameDraft);
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
          aria-label={`جابجایی ستون ${column.name}`}
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
                aria-label="نام ستون"
                className="column-name-input"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onKeyDown={handleNameKeyDown}
                autoFocus
              />
            </form>
          ) : (
            <h3 className="column-name" id={`column-heading-${column.id}`}>
              {column.name}
            </h3>
          )}
        </div>
        <span className="column-count" aria-label={`${column.cards.length} کارت`}>
          {column.cards.length}
        </span>
        <button
          className="icon-button"
          type="button"
          aria-label={`تغییر نام ستون ${column.name}`}
          title="تغییر نام ستون"
          onClick={() => {
            setNameDraft(column.name);
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
              onEdit={(title, details) =>
                onEditCard(card.id, title, details)
              }
              onDelete={() => onDeleteCard(card.id)}
            />
          ))}
          {column.cards.length === 0 && (
            <p className="empty-column">هنوز کارتی در این ستون نیست.</p>
          )}
        </div>
      </SortableContext>

      {isAddingCard ? (
        <AddCardForm
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
          aria-label={`افزودن کارت به ${column.name}`}
          onClick={() => setIsAddingCard(true)}
        >
          <Plus size={15} />
          افزودن کارت
        </button>
      )}
    </section>
  );
}

interface AddCardFormProps {
  onSubmit: (title: string, details: string) => void;
  onCancel: () => void;
}

function AddCardForm({ onSubmit, onCancel }: AddCardFormProps) {
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
        aria-label="عنوان کارت"
        className="form-field"
        placeholder="عنوان کارت"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        required
        autoFocus
      />
      <textarea
        aria-label="جزئیات کارت"
        className="form-field details-field"
        placeholder="جزئیات"
        value={details}
        onChange={(event) => setDetails(event.target.value)}
      />
      <div className="form-actions">
        <button className="submit-button" type="submit">
          <Check size={14} />
          ثبت کارت
        </button>
        <button className="cancel-button" type="button" onClick={onCancel}>
          انصراف
        </button>
      </div>
    </form>
  );
}

interface SortableCardProps {
  card: Card;
  onEdit: (title: string, details: string) => void;
  onDelete: () => void;
}

function SortableCard({ card, onEdit, onDelete }: SortableCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id });

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
              aria-label={`جابجایی کارت ${card.title}`}
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
                aria-label={`ویرایش کارت ${card.title}`}
                title="ویرایش کارت"
                onClick={() => setIsEditing(true)}
              >
                <Pencil size={14} />
              </button>
              <button
                className="icon-button delete-button"
                type="button"
                aria-label={`حذف کارت ${card.title}`}
                title="حذف کارت"
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
  onSubmit,
  onCancel,
}: {
  card: Card;
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
        aria-label="عنوان کارت"
        className="form-field"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        required
        autoFocus
      />
      <textarea
        aria-label="جزئیات کارت"
        className="form-field details-field"
        value={details}
        onChange={(event) => setDetails(event.target.value)}
      />
      <div className="form-actions">
        <button className="submit-button" type="submit">
          <Check size={14} />
          ذخیره تغییرات
        </button>
        <button className="cancel-button" type="button" onClick={onCancel}>
          انصراف
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

function ColumnPreview({ column }: { column: Column }) {
  return (
    <section className="kanban-column drag-column-overlay" aria-hidden="true">
      <header className="column-header">
        <h3 className="column-name">{column.name}</h3>
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
