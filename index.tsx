import ErrorBoundary from "@components/ErrorBoundary";
import { ModalCloseButton, ModalContent, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { findStoreLazy } from "@webpack";
import { ChannelStore, FluxDispatcher, GuildMemberStore, React, SelectedChannelStore, Text, UserStore } from "@webpack/common";

const VoiceStateStore = findStoreLazy("VoiceStateStore");

interface LogEntryData {
    key: string;
    type: "join" | "leave" | "move";
    userId: string;
    timestamp: number;
}

const MAX_ENTRIES = 200;

let log: LogEntryData[] = [];
let knownChannelForUser = new Map<string, string | null>();
let lastKnownMyChannel: string | null = null;
const listeners = new Set<() => void>();

function emitChange() {
    listeners.forEach(listener => listener());
}

function addEntry(type: "join" | "leave" | "move", userId: string) {
    const key = `${Date.now()}-${userId}-${type}-${Math.random().toString(36).slice(2, 7)}`;
    log = [...log, { key, type, userId, timestamp: Date.now() }].slice(-MAX_ENTRIES);
    console.log(`[VoiceChannelLogger] ${type}:`, userId);
    emitChange();
}

function clearLog() {
    log = [];
    emitChange();
}

function syncBaseline(channelId: string | null) {
    knownChannelForUser.clear();
    if (!channelId) return;

    const states = VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {};
    for (const userId in states) {
        knownChannelForUser.set(userId, channelId);
    }
}

function handleVoiceStateUpdates({ voiceStates }: { voiceStates: Array<{ userId: string; channelId?: string; }>; }) {
    const myChannel: string | null = SelectedChannelStore.getVoiceChannelId() ?? null;

    if (myChannel !== lastKnownMyChannel) {
        lastKnownMyChannel = myChannel;
        syncBaseline(myChannel);
        clearLog();
        return;
    }

    if (myChannel == null) return;

    const selfId = UserStore.getCurrentUser()?.id;

    for (const state of voiceStates) {
        const { userId, channelId } = state;
        if (userId === selfId) continue;

        const prevChannel = knownChannelForUser.has(userId) ? knownChannelForUser.get(userId) : null;
        const wasHere = prevChannel === myChannel;
        const isHere = channelId === myChannel;

        if (!wasHere && isHere) addEntry("join", userId);
        else if (wasHere && !isHere) {
            if (channelId) addEntry("move", userId);
            else addEntry("leave", userId);
        }

        knownChannelForUser.set(userId, channelId ?? null);
    }
}

function useLogEntries(): LogEntryData[] {
    return React.useSyncExternalStore(
        listener => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        () => log
    );
}

function openUserProfile(userId: string) {
    try {
        FluxDispatcher.dispatch({
            type: "USER_PROFILE_MODAL_OPEN",
            userId
        });
    } catch (e) {
        console.error("[VoiceChannelLogger] Failed to open profile for", userId, e);
    }
}

function JoinArrow() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" style={{ flexShrink: 0, color: "#23a55a" }}>
            <path fill="currentColor" d="M4 11v2h12l-4.5 4.5 1.42 1.42L19.84 12l-6.92-6.92L11.5 6.5 16 11H4Z" />
        </svg>
    );
}

function LeaveArrow() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" style={{ flexShrink: 0, color: "#f23f42" }}>
            <path fill="currentColor" d="M20 11v2H8l4.5 4.5-1.42 1.42L4.16 12l6.92-6.92L12.5 6.5 8 11h12Z" />
        </svg>
    );
}

function MoveArrow() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" style={{ flexShrink: 0, color: "#f0b232" }}>
            <path fill="currentColor" d="M6 18 17.5 6.5H10V4.5h11v11h-2V8.12L7.5 19.5 6 18Z" />
        </svg>
    );
}

function LogIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24">
            <path
                fill="currentColor"
                d="M4 5h16v2H4V5Zm0 6h10v2H4v-2Zm0 6h16v2H4v-2Z"
            />
        </svg>
    );
}

function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const ENTRY_INFO: Record<LogEntryData["type"], { label: string; color: string; }> = {
    join: { label: "Joined the call", color: "#23a55a" },
    leave: { label: "Left the call", color: "#f23f42" },
    move: { label: "Moved voice calls", color: "#f0b232" }
};

function LogRow({ entry, large }: { entry: LogEntryData; large?: boolean; }) {
    const user = UserStore.getUser(entry.userId);
    const currentVoiceChannelId = SelectedChannelStore.getVoiceChannelId();
    const guildId = currentVoiceChannelId ? ChannelStore.getChannel(currentVoiceChannelId)?.guild_id : undefined;
    const nick = guildId ? GuildMemberStore.getNick(guildId, entry.userId) : null;
    const name = nick ?? user?.globalName ?? user?.username ?? entry.userId;
    const avatarSize = large ? 32 : 20;
    const avatarUrl = user?.getAvatarURL?.(undefined, avatarSize);
    const { label, color } = ENTRY_INFO[entry.type];

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => openUserProfile(entry.userId)}
            style={{
                display: "flex",
                alignItems: "center",
                gap: large ? 12 : 8,
                padding: large ? "8px 10px" : "4px 6px",
                borderRadius: 4,
                cursor: "pointer"
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--background-modifier-hover, rgba(255,255,255,0.05))")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
        >
            {entry.type === "join" ? <JoinArrow /> : entry.type === "leave" ? <LeaveArrow /> : <MoveArrow />}
            {avatarUrl ? (
                <img src={avatarUrl} width={avatarSize} height={avatarSize} style={{ borderRadius: "50%", flexShrink: 0 }} />
            ) : (
                <div style={{ width: avatarSize, height: avatarSize, borderRadius: "50%", background: "var(--background-secondary, #313338)", flexShrink: 0 }} />
            )}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{
                    fontSize: large ? 16 : 13,
                    color: "var(--text-normal, #dbdee1)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis"
                }}>
                    {name}
                </span>
                <span style={{ fontSize: large ? 13 : 11, color }}>
                    {label}
                </span>
            </div>
            <span style={{ fontSize: large ? 13 : 11, color: "var(--text-muted, #949ba4)", flexShrink: 0 }}>
                {formatTime(entry.timestamp)}
            </span>
        </div>
    );
}

function LogModal({ modalProps }: { modalProps: ModalProps; }) {
    const entries = useLogEntries();

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ flex: 1 }}>Voice Channel Log</Text>
                <span
                    role="button"
                    onClick={clearLog}
                    style={{ fontSize: 14, color: "#ffffff", cursor: "pointer", marginRight: 16 }}
                >
                    Clear
                </span>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent>
                <div style={{ padding: "12px 0", maxHeight: "65vh", overflowY: "auto" }}>
                    {entries.length === 0 ? (
                        <div style={{ fontSize: 15, color: "#ffffff", padding: "8px 2px" }}>
                            No joins, leaves, or moves yet this call.
                        </div>
                    ) : (
                        entries.map(entry => <LogRow key={entry.key} entry={entry} large />)
                    )}
                </div>
            </ModalContent>
        </ModalRoot>
    );
}

function ToolbarIcon() {
    return (
        <div
            role="button"
            aria-label="Voice Channel Log"
            title="Voice Channel Log"
            style={{
                display: "flex",
                alignItems: "center",
                cursor: "pointer",
                marginRight: 8,
                color: "var(--interactive-normal, #b5bac1)"
            }}
            onClick={() => openModal(modalProps => <LogModal modalProps={modalProps} />)}
        >
            <LogIcon />
        </div>
    );
}

const ToolbarIconSafe = ErrorBoundary.wrap(ToolbarIcon, { noop: true });

export default definePlugin({
    name: "VoiceChannelLogger",
    description: "Toolbar icon showing who joined/left/moved from the voice channel you're currently in, with clickable profiles.",
    authors: [{ name: "mar", id: 1531845646842073301n }],

    patches: [
        {
            find: "showDivider:null!=",
            replacement: {
                match: /children:\[(?=\i,\i&&\(0,\i\.jsx\)\(\i,\{windowKey:\i,showDivider:null!=\i\}\)\])/,
                replace: "$&$self.renderToolbarIcon(),"
            }
        }
    ],

    renderToolbarIcon: () => <ToolbarIconSafe />,

    start() {
        lastKnownMyChannel = SelectedChannelStore.getVoiceChannelId() ?? null;
        syncBaseline(lastKnownMyChannel);
        clearLog();
        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", handleVoiceStateUpdates);
    },

    stop() {
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", handleVoiceStateUpdates);
    }
});
