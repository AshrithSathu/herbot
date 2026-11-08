package main

// Herbot extensions to the vendored bridge. Kept in this file so upstream
// merges stay easy. See README.md for the full list of changes.
//
//   - Every message webhook also carries senderJid, timestamp and isGroup.
//   - Group membership events go to the webhook: group_joined, group_left
//     and group_renamed. herbot-core uses them to create pending groups.
//   - WHATSAPP_BRIDGE_BIND and WHATSAPP_BRIDGE_ALLOWED_HOSTS let the REST API
//     run inside a Docker network (default stays loopback-only).

import (
	"os"
	"strings"
	"time"

	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

// Webhook event types added by Herbot. Plain messages keep an empty EventType
// (upstream behaviour) and reactions keep "reaction".
const (
	EventGroupJoined  = "group_joined"
	EventGroupLeft    = "group_left"
	EventGroupRenamed = "group_renamed"
)

// MessageMeta is the extra per-message data herbot-core needs. It is passed as
// an optional trailing argument so upstream call sites and tests keep working.
type MessageMeta struct {
	// SenderJID is the resolved sender. "@s.whatsapp.net" means a phone number
	// was found; "@lid" means WhatsApp hid it and no mapping is known yet.
	SenderJID string
	// Timestamp is when the message was sent (unix seconds).
	Timestamp int64
	// IsGroup is true for group chats.
	IsGroup bool
}

func applyMessageMeta(p *WebhookPayload, meta []MessageMeta) {
	if len(meta) == 0 {
		return
	}
	m := meta[0]
	p.SenderJID = m.SenderJID
	p.Timestamp = m.Timestamp
	p.IsGroup = m.IsGroup
}

// messageMetaFor builds MessageMeta from an incoming message event.
func messageMetaFor(info types.MessageInfo, resolvedSender types.JID) MessageMeta {
	return MessageMeta{
		SenderJID: resolvedSender.ToNonAD().String(),
		Timestamp: info.Timestamp.Unix(),
		IsGroup:   info.IsGroup,
	}
}

// actorJID picks the best identity for whoever triggered a group event:
// the phone-number JID when WhatsApp provides one, else the raw sender.
func actorJID(sender, senderPN *types.JID) string {
	if senderPN != nil && !senderPN.IsEmpty() {
		return senderPN.ToNonAD().String()
	}
	if sender != nil && !sender.IsEmpty() {
		return sender.ToNonAD().String()
	}
	return ""
}

func communityJIDOf(info types.GroupInfo) string {
	if info.LinkedParentJID.IsEmpty() {
		return ""
	}
	return info.LinkedParentJID.String()
}

// groupJoinedPayload is sent when the bot's number is added to a group
// (or joins through an invite link).
func groupJoinedPayload(v *events.JoinedGroup) WebhookPayload {
	// JoinedGroup has no "added at" time (GroupCreated is when the group was
	// made), so stamp it with when the bridge saw the event.
	ts := time.Now()
	return WebhookPayload{
		EventType:    EventGroupJoined,
		ChatJID:      v.JID.String(),
		Sender:       actorJID(v.Sender, v.SenderPN),
		SenderJID:    actorJID(v.Sender, v.SenderPN),
		GroupName:    v.Name,
		CommunityJID: communityJIDOf(v.GroupInfo),
		JoinReason:   v.Reason,
		Timestamp:    ts.Unix(),
		IsGroup:      true,
	}
}

// isSelf reports whether jid is this bridge's own account, by phone or LID.
func isSelf(jid, selfPN, selfLID types.JID) bool {
	user := jid.ToNonAD()
	if !selfPN.IsEmpty() && user.User == selfPN.User && user.Server == selfPN.Server {
		return true
	}
	if !selfLID.IsEmpty() && user.User == selfLID.User && user.Server == selfLID.Server {
		return true
	}
	return false
}

// groupInfoPayloads turns a group metadata change into zero or more Herbot
// events. Only changes herbot-core acts on are reported: the bot being
// removed, and the group being renamed.
func groupInfoPayloads(v *events.GroupInfo, selfPN, selfLID types.JID) []WebhookPayload {
	var out []WebhookPayload
	actor := actorJID(v.Sender, v.SenderPN)
	ts := v.Timestamp.Unix()

	for _, left := range v.Leave {
		if isSelf(left, selfPN, selfLID) {
			out = append(out, WebhookPayload{
				EventType: EventGroupLeft,
				ChatJID:   v.JID.String(),
				Sender:    actor,
				SenderJID: actor,
				Timestamp: ts,
				IsGroup:   true,
			})
			break
		}
	}
	if v.Name != nil {
		out = append(out, WebhookPayload{
			EventType: EventGroupRenamed,
			ChatJID:   v.JID.String(),
			Sender:    actor,
			SenderJID: actor,
			GroupName: v.Name.Name,
			Timestamp: ts,
			IsGroup:   true,
		})
	}
	return out
}

// sendGroupWebhooks delivers group events. Called from the event handler.
func sendGroupWebhooks(payloads ...WebhookPayload) {
	for _, p := range payloads {
		sendWebhookPayload(p)
	}
}

// selfJIDs returns this account's phone JID and LID (either may be empty
// before pairing).
func selfJIDs(storeID *types.JID, storeLID types.JID) (types.JID, types.JID) {
	var pn types.JID
	if storeID != nil {
		pn = storeID.ToNonAD()
	}
	return pn, storeLID.ToNonAD()
}

// bridgeBindHost is the interface the REST API listens on. Defaults to
// loopback; set WHATSAPP_BRIDGE_BIND=0.0.0.0 inside a private Docker network.
func bridgeBindHost() string {
	if h := strings.TrimSpace(os.Getenv("WHATSAPP_BRIDGE_BIND")); h != "" {
		return h
	}
	return "127.0.0.1"
}

// extraAllowedHosts reads WHATSAPP_BRIDGE_ALLOWED_HOSTS, a comma-separated
// list of extra Host headers to accept, e.g. "wa-bridge:8080".
func extraAllowedHosts() []string {
	raw := os.Getenv("WHATSAPP_BRIDGE_ALLOWED_HOSTS")
	var hosts []string
	for _, h := range strings.Split(raw, ",") {
		if h = strings.ToLower(strings.TrimSpace(h)); h != "" {
			hosts = append(hosts, h)
		}
	}
	return hosts
}
