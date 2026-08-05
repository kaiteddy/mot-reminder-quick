import { useState, useEffect, useRef } from "react";
import { displayDocNo } from "@/lib/docType";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Send, CheckCircle2, Clock, Eye, XCircle, Search, BellOff, Bell, CalendarPlus, Car, Wrench, ExternalLink, ShieldCheck, CalendarClock, AlertTriangle, ChevronLeft, Loader2 } from "lucide-react";
import { usePushNotifications } from "@/lib/usePushNotifications";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import DashboardLayout from "@/components/DashboardLayout";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { RegPlate } from "@/components/RegPlate";
import { LineItemsView } from "@/components/ServiceHistory";
import { useLocation } from "wouter";

const DOC_TYPE_LABEL: Record<string, string> = {
  SI: "Invoice", ES: "Estimate", JS: "Job Sheet", CR: "Credit Note", XS: "Excess",
};
const DOC_TYPE_COLOR: Record<string, string> = {
  SI: "bg-green-100 text-green-800", ES: "bg-blue-100 text-blue-800",
  JS: "bg-amber-100 text-amber-800", CR: "bg-red-100 text-red-800", XS: "bg-fuchsia-100 text-fuchsia-800",
};
const money = (v: any) => (v == null ? "—" : `£${Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fmtDate = (d: any) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");

export default function Conversations() {
  const [, setLocation] = useLocation();
  // ?customer=<id> opens that thread straight away — the link in the notification, so tapping
  // it on a phone lands directly on the conversation.
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(() => {
    const id = Number(new URLSearchParams(window.location.search).get("customer"));
    return Number.isFinite(id) && id > 0 ? id : null;
  });
  const [replyMessage, setReplyMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: threads, refetch: refetchThreads } = trpc.conversations.getThreads.useQuery();
  const { data: messages, refetch: refetchMessages } = trpc.conversations.getMessages.useQuery(
    { customerId: selectedCustomerId! },
    { enabled: selectedCustomerId !== null }
  );

  const markAsReadMutation = trpc.conversations.markAsRead.useMutation({
    onSuccess: () => {
      refetchThreads();
    },
  });

  // WhatsApp only accepts a free-form reply within 24h of the customer's last message; after
  // that the server falls back to SMS. Surfaced so the channel is never a surprise.
  const { data: replyWindow, refetch: refetchWindow } = trpc.conversations.replyWindow.useQuery(
    { customerId: selectedCustomerId! },
    { enabled: selectedCustomerId !== null },
  );

  const sendReplyMutation = trpc.conversations.sendReply.useMutation({
    onSuccess: (res: any) => {
      toast.success(res?.channel === "sms"
        ? "WhatsApp window had closed — sent as a text instead"
        : "Message sent successfully");
      setReplyMessage("");
      refetchMessages();
      refetchThreads();
      refetchWindow();
    },
    onError: (error) => {
      toast.error(`Failed to send message: ${error.message}`);
    },
  });

  const optOutMutation = trpc.customers.setOptOut.useMutation({
    onSuccess: (res) => {
      toast.success(res.optedOut ? "Reminders stopped for this customer" : "Reminders re-enabled");
      refetchThreads();
    },
    onError: (e) => toast.error(e.message || "Couldn't update reminder status"),
  });

  // Book the customer in for an MOT — drops them into the MOT bay so the day-of reminder cron
  // texts them automatically on the morning of the appointment.
  const [bookOpen, setBookOpen] = useState(false);
  const [bookForm, setBookForm] = useState({ date: "", time: "09:00", notes: "" });
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const addMins = (hhmm: string, mins: number) => {
    const [h, m] = hhmm.split(":").map(Number);
    const t = h * 60 + m + mins;
    return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  };
  const createApptMutation = trpc.appointments.create.useMutation({
    onSuccess: () => {
      toast.success("Booked in — a reminder will go out on the morning of the appointment");
      setBookOpen(false);
      refetchThreads();
    },
    onError: (e) => toast.error(e.message || "Couldn't create the booking"),
  });
  const submitBooking = () => {
    if (!selectedThread) return;
    if (!bookForm.date) { toast.error("Pick a date"); return; }
    createApptMutation.mutate({
      customerId: selectedThread.customerId,
      registration: selectedThread.vehicleRegistration || undefined,
      customerName: selectedThread.customerName,
      customerPhone: selectedThread.customerPhone,
      vehicleMake: selectedThread.vehicleMake || undefined,
      vehicleModel: selectedThread.vehicleModel || undefined,
      bayId: "mot-bay",
      serviceType: "MOT",
      appointmentDate: bookForm.date,
      startTime: bookForm.time || undefined,
      endTime: bookForm.time ? addMins(bookForm.time, 60) : undefined,
      notes: bookForm.notes || undefined,
    });
  };

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Mark as read when conversation is opened
  useEffect(() => {
    if (selectedCustomerId) {
      markAsReadMutation.mutate({ customerId: selectedCustomerId });
    }
  }, [selectedCustomerId]);

  const selectedThread = threads?.find(t => t.customerId === selectedCustomerId);

  // WhatsApp only allows freeform replies within 24h of the customer's last inbound message —
  // outside that window Meta silently rejects them and Twilio reports back "undelivered".
  const lastInboundAt = selectedThread?.lastInboundAt ? new Date(selectedThread.lastInboundAt) : null;
  const hoursSinceInbound = lastInboundAt ? (Date.now() - lastInboundAt.getTime()) / 36e5 : null;
  const outsideReplyWindow = hoursSinceInbound === null || hoursSinceInbound > 24;

  // Pulls the car's spec + its full job history so staff can answer "is it due for a service"
  // (or similar) type questions without leaving the conversation to go dig it up elsewhere.
  const { data: vehicleInfo } = trpc.vehicles.getByRegistration.useQuery(
    { registration: selectedThread?.vehicleRegistration ?? "" },
    { enabled: !!selectedThread?.vehicleRegistration }
  );

  const filteredThreads = threads?.filter(thread =>
    thread.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    thread.customerPhone.includes(searchQuery) ||
    thread.vehicleRegistration?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSendReply = () => {
    if (!selectedCustomerId || !selectedThread || !replyMessage.trim()) return;

    sendReplyMutation.mutate({
      customerId: selectedCustomerId,
      phoneNumber: selectedThread.customerPhone,
      message: replyMessage.trim(),
    });
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case "read":
        return <span title="Read"><Eye className="w-4 h-4 text-blue-500" /></span>;
      case "delivered":
        return <span title="Delivered"><CheckCircle2 className="w-4 h-4 text-green-500" /></span>;
      case "failed":
        return <span title="Failed"><XCircle className="w-4 h-4 text-red-500" /></span>;
      case "sent":
      case "queued":
        return <span title="Sent"><Clock className="w-4 h-4 text-gray-500" /></span>;
      default:
        return null;
    }
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const messageDate = new Date(date);
    const diffMs = now.getTime() - messageDate.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return messageDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  };

  return (
    <DashboardLayout>
      {/* dvh, not vh: mobile browser chrome shrinks the viewport and vh would push the
          reply box off the bottom of the screen. */}
      <div className="h-[calc(100dvh-7rem)] md:h-[calc(100vh-8rem)] flex flex-col bg-slate-50 border rounded-lg overflow-hidden">
        {/* Header — hidden on mobile once a thread is open, so the phone screen is all conversation */}
        <div className={cn("bg-white border-b px-4 py-3 md:px-6 md:py-4 flex items-start justify-between gap-3", selectedCustomerId && "hidden md:flex")}>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-900">Conversations</h1>
            <p className="text-sm text-slate-600 mt-1">
              WhatsApp-style message threads with customers
            </p>
          </div>
          <NotificationsButton />
        </div>

        <div className="flex-1 flex overflow-hidden @container">
          {/* Conversation List Sidebar — full width on a phone, and stands aside once a thread is picked */}
          <div className={cn(
            "w-full md:w-72 @5xl:w-80 @6xl:w-96 bg-white md:border-r flex-col shrink-0",
            selectedCustomerId ? "hidden md:flex" : "flex",
          )}>
            {/* Search */}
            <div className="p-4 border-b">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search conversations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Thread List */}
            <div className="flex-1 overflow-y-auto">
              {filteredThreads?.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  <p className="text-sm">No conversations yet</p>
                  <p className="text-xs mt-1">Send a reminder to start a conversation</p>
                </div>
              ) : (
                filteredThreads?.map((thread) => (
                  <button
                    key={thread.customerId}
                    onClick={() => setSelectedCustomerId(thread.customerId)}
                    className={cn(
                      "w-full p-4 border-b hover:bg-slate-50 text-left transition-colors",
                      selectedCustomerId === thread.customerId && "bg-blue-50 border-l-4 border-l-blue-500"
                    )}
                  >
                    <div className="flex items-start justify-between mb-1">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 truncate">
                            {thread.customerName}
                          </span>
                          {thread.unreadCount > 0 && (
                            <Badge variant="destructive" className="text-xs px-1.5 py-0">
                              {thread.unreadCount}
                            </Badge>
                          )}
                        </div>
                        {thread.vehicleRegistration && (
                          <div className="text-xs text-slate-600 font-mono truncate max-w-[180px]">
                            {thread.vehicleRegistration}
                            {thread.vehicleMake && <span className="font-sans text-slate-500 ml-1">• {thread.vehicleMake} {thread.vehicleModel}</span>}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        {getStatusIcon(thread.deliveryStatus || undefined)}
                        <span className="text-xs text-slate-500 whitespace-nowrap">
                          {formatTime(thread.lastMessageAt)}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-slate-600 truncate">
                      {thread.lastMessagePreview}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Conversation Detail */}
          <div className={cn(
            "flex-1 flex-col bg-slate-50 min-w-0",
            selectedCustomerId ? "flex" : "hidden md:flex",
          )}>
            {selectedThread ? (
              <>
                {/* Conversation Header */}
                {/* stacks on a phone — side by side there isn't room for the name and the actions */}
                <div className="bg-white border-b px-4 py-3 md:px-6 md:py-4 flex flex-col md:flex-row md:items-start md:justify-between gap-2 md:gap-4">
                  <div className="min-w-0 flex-1 flex items-start gap-2">
                    {/* back to the thread list — phone only, where the list is hidden */}
                    <button
                      type="button"
                      onClick={() => setSelectedCustomerId(null)}
                      aria-label="Back to conversations"
                      className="md:hidden -ml-1 mt-0.5 p-1 rounded hover:bg-slate-100 text-slate-600 shrink-0"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <div className="min-w-0 flex-1">
                    <h2 className="font-semibold text-base md:text-lg text-slate-900 flex items-center gap-2 flex-wrap">
                      <span className="truncate">{selectedThread.customerName}</span>
                      {selectedThread.optedOut && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 shrink-0">
                          <BellOff className="w-3 h-3" /> Reminders stopped
                        </span>
                      )}
                    </h2>
                    <div className="flex items-center gap-2 text-xs md:text-sm text-slate-600 mt-1 min-w-0">
                      <span className="shrink-0">{selectedThread.customerPhone}</span>
                      {selectedThread.vehicleRegistration && (
                        <>
                          <span className="shrink-0">•</span>
                          <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-700 shrink-0">
                            {selectedThread.vehicleRegistration}
                          </span>
                          {selectedThread.vehicleMake && (
                            <span className="text-slate-500 truncate">
                              {selectedThread.vehicleMake} {selectedThread.vehicleModel}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setBookForm({ date: "", time: "09:00", notes: "" }); setBookOpen(true); }}
                      className="border-blue-300 text-blue-700 hover:bg-blue-50"
                      title="Book this customer in for an MOT — sends a reminder on the day"
                    >
                      <CalendarPlus className="w-4 h-4 @6xl:mr-1.5" /> <span className="hidden @6xl:inline">Book in</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={optOutMutation.isPending}
                      onClick={() => optOutMutation.mutate({ customerId: selectedThread.customerId, optOut: !selectedThread.optedOut })}
                      className={cn(selectedThread.optedOut
                        ? "border-green-300 text-green-700 hover:bg-green-50"
                        : "border-red-300 text-red-700 hover:bg-red-50")}
                      title={selectedThread.optedOut ? "Re-enable MOT reminders for this customer" : "Stop sending MOT reminders to this customer"}
                    >
                      {selectedThread.optedOut
                        ? <><Bell className="w-4 h-4 @6xl:mr-1.5" /> <span className="hidden @6xl:inline">Re-enable reminders</span></>
                        : <><BellOff className="w-4 h-4 @6xl:mr-1.5" /> <span className="hidden @6xl:inline">Stop reminders</span></>}
                    </Button>
                  </div>
                </div>

                {/* Book-in dialog */}
                <Dialog open={bookOpen} onOpenChange={setBookOpen}>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Book in {selectedThread.customerName}</DialogTitle>
                      <DialogDescription>
                        Creates an MOT booking{selectedThread.vehicleRegistration ? ` for ${selectedThread.vehicleRegistration}` : ""}. A WhatsApp reminder is sent automatically on the morning of the appointment.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <label className="text-xs font-medium text-slate-600">Date</label>
                          <input type="date" min={todayStr} value={bookForm.date} onChange={(e) => setBookForm((f) => ({ ...f, date: e.target.value }))}
                            className="w-full border rounded px-2 py-1.5 text-sm mt-0.5 outline-none focus:border-violet-500" />
                        </div>
                        <div className="w-28">
                          <label className="text-xs font-medium text-slate-600">Time</label>
                          <input type="time" value={bookForm.time} onChange={(e) => setBookForm((f) => ({ ...f, time: e.target.value }))}
                            className="w-full border rounded px-2 py-1.5 text-sm mt-0.5 outline-none focus:border-violet-500" />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-600">Notes <span className="text-slate-400">(optional)</span></label>
                        <input value={bookForm.notes} onChange={(e) => setBookForm((f) => ({ ...f, notes: e.target.value }))} placeholder="e.g. confirmed by WhatsApp"
                          className="w-full border rounded px-2 py-1.5 text-sm mt-0.5 outline-none focus:border-violet-500" />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button variant="outline" size="sm" onClick={() => setBookOpen(false)}>Cancel</Button>
                      <Button size="sm" onClick={submitBooking} disabled={createApptMutation.isPending} className="bg-blue-600 text-white hover:bg-blue-700">
                        <CalendarPlus className="w-4 h-4 mr-1.5" /> Book in
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-3 md:p-6 space-y-3 md:space-y-4">
                  {messages?.map((message) => (
                    <div
                      key={`${message.type}-${message.id}`}
                      className={cn(
                        "flex",
                        message.type === "sent" ? "justify-end" : "justify-start"
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-[85%] md:max-w-[70%] rounded-lg px-3 py-2 md:px-4 shadow-sm",
                          message.type === "sent"
                            ? "bg-blue-500 text-white"
                            : "bg-white text-slate-900"
                        )}
                      >
                        {message.vehicleRegistration && (
                          <div className={cn(
                            "text-xs font-mono mb-1",
                            message.type === "sent" ? "text-blue-100" : "text-slate-500"
                          )}>
                            {message.vehicleRegistration} • {message.messageType}
                          </div>
                        )}
                        <p className="text-sm whitespace-pre-wrap break-words">
                          {message.content}
                        </p>
                        <div className={cn(
                          "flex items-center gap-1 mt-1 text-xs",
                          message.type === "sent" ? "text-blue-100 justify-end" : "text-slate-500"
                        )}>
                          <span>
                            {new Date(message.timestamp).toLocaleTimeString("en-GB", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          {/* WhatsApp and texts now share one thread, so say which carried it */}
                          {(message as any).channel && (
                            <span
                              className={cn(
                                "ml-1 px-1 rounded text-[10px] font-medium tracking-wide",
                                message.type === "sent"
                                  ? "bg-white/20 text-blue-50"
                                  : "bg-slate-200/80 text-slate-600",
                              )}
                              title={(message as any).channel === "sms"
                                ? "Sent as a text message"
                                : "Sent on WhatsApp"}
                            >
                              {(message as any).channel === "sms" ? "SMS" : "WhatsApp"}
                            </span>
                          )}
                          {message.type === "sent" && message.status && (
                            <span className="ml-1">{getStatusIcon(message.status)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                {/* Reply Input — pb accounts for the iOS home indicator when installed to the home screen */}
                <div className="bg-white border-t p-3 md:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-4">
                  {outsideReplyWindow && (
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-md px-3 py-2 mb-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        {lastInboundAt
                          ? `${selectedThread?.customerName} last messaged ${formatTime(lastInboundAt)} — WhatsApp only allows free-text replies within 24h of a customer's last message, so this will be sent as a text message instead.`
                          : `${selectedThread?.customerName} hasn't messaged you, so WhatsApp won't accept a free-text reply — this will be sent as a text message instead.`}
                      </span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Input
                      placeholder="Type a message..."
                      value={replyMessage}
                      onChange={(e) => setReplyMessage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendReply();
                        }
                      }}
                      // 16px minimum stops iOS Safari zooming the page when the field is focused
                      className="flex-1 text-base md:text-sm"
                    />
                    <Button
                      onClick={handleSendReply}
                      disabled={!replyMessage.trim() || sendReplyMutation.isPending}
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                  <ReplyChannelHint window={replyWindow} />
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-500">
                <div className="text-center">
                  <p className="text-lg font-medium">Select a conversation</p>
                  <p className="text-sm mt-1">Choose a customer from the list to view messages</p>
                </div>
              </div>
            )}
          </div>

          {/* Vehicle + Job History Sidebar — so a question like "is it due for a service" can be
              answered from the car's own record without leaving the conversation. */}
          {/* Only shown at ≥1536px. The 384px thread list + this 288px panel already total 672px —
              xl (1280px) still left the conversation column squeezed to ~260px (name collapsing to
              zero width). 2xl leaves it a comfortable ~500px after the sidebar nav's own chrome. */}
          {selectedThread?.vehicleRegistration && (
            <div className="hidden @4xl:flex w-56 @5xl:w-64 @6xl:w-72 bg-white border-l flex-col overflow-hidden shrink-0">
              <div className="border-b p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <RegPlate reg={selectedThread.vehicleRegistration} size="sm" />
                </div>
                <div className="text-sm font-semibold text-slate-900 truncate">
                  {[vehicleInfo?.vehicle?.make || selectedThread.vehicleMake, vehicleInfo?.vehicle?.model || selectedThread.vehicleModel].filter(Boolean).join(" ") || "—"}
                </div>
                {vehicleInfo?.vehicle && (
                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 pt-1">
                    <div className="flex items-center gap-1.5">
                      <CalendarClock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>MOT {fmtDate(vehicleInfo.vehicle.motExpiryDate)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{vehicleInfo.vehicle.taxStatus || "Tax unknown"}</span>
                    </div>
                    {vehicleInfo.latestMileage != null && (
                      <div className="col-span-2 text-slate-500">Last mileage {Number(vehicleInfo.latestMileage).toLocaleString("en-GB")}</div>
                    )}
                  </div>
                )}
              </div>
              <div className="border-b px-4 py-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Wrench className="w-3.5 h-3.5" /> Previous Work
              </div>
              <div className="flex-1 overflow-y-auto">
                {!vehicleInfo ? (
                  <p className="p-4 text-sm text-slate-400">Loading…</p>
                ) : (vehicleInfo.history?.length ?? 0) === 0 ? (
                  <p className="p-4 text-sm text-slate-400">No previous jobs on file for this car.</p>
                ) : (
                  vehicleInfo.history.map((h: any) => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => setSelectedDocId(h.id)}
                      className="block w-full text-left px-4 py-2.5 border-b hover:bg-slate-50 group"
                      title="View this document"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", DOC_TYPE_COLOR[h.docType] || "bg-slate-100 text-slate-700")}>
                          {DOC_TYPE_LABEL[h.docType] || h.docType}
                        </span>
                        <span className="text-xs text-slate-500 whitespace-nowrap">{fmtDate(h.dateIssued || h.dateCreated)}</span>
                      </div>
                      <div className="text-xs text-slate-700 leading-snug line-clamp-2 mt-1" title={h.mainDescription || h.description || undefined}>
                        {h.mainDescription || h.description || "—"}
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-xs text-slate-400">#{displayDocNo(h)}</span>
                        <span className="text-xs font-medium text-slate-600">{money(h.totalGross)}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Pops the job/invoice up in place — no need to leave the conversation to see what it was. */}
      <Dialog open={selectedDocId !== null} onOpenChange={(open) => !open && setSelectedDocId(null)}>
        <DialogContent className="max-w-4xl sm:max-w-[85vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Document Details</DialogTitle>
            <DialogDescription className="sr-only">Detailed view of the selected workshop document and its line items.</DialogDescription>
          </DialogHeader>
          {selectedDocId && vehicleInfo?.history && (
            <div className="space-y-4">
              <LineItemsView documentId={selectedDocId} history={vehicleInfo.history} />
              <div className="flex justify-end pt-4 border-t">
                <Button variant="outline" size="sm" onClick={() => setLocation(`/documents/${selectedDocId}`)}>
                  <ExternalLink className="h-4 w-4 mr-2" /> Open Full Job Sheet
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

/**
 * Turn on lock-screen notifications for this device. Placed in the Conversations header rather
 * than buried in settings because that's where you are when you realise you're missing messages.
 */
function NotificationsButton() {
  const { state, busy, enable, disable, configured } = usePushNotifications();
  const test = trpc.push.test.useMutation();

  if (!configured || state === "unsupported") return null;

  if (state === "needs-install") {
    return (
      <div className="text-[11px] text-slate-500 max-w-[10rem] text-right leading-snug">
        To get alerts on this phone: <b>Share → Add to Home Screen</b>, then open it from there.
      </div>
    );
  }
  if (state === "denied") {
    return (
      <div className="text-[11px] text-amber-700 max-w-[10rem] text-right leading-snug">
        Notifications are blocked — turn them back on in your phone's settings for this app.
      </div>
    );
  }
  if (state === "on") {
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="hidden sm:inline text-[11px] text-green-700 font-medium">Alerts on</span>
        <Button variant="outline" size="sm" onClick={() => test.mutate()} disabled={test.isPending} title="Send a test notification to this device">
          {test.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bell className="w-3.5 h-3.5" />}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => disable()} disabled={busy} title="Stop notifications on this device">
          <BellOff className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  }
  return (
    <Button size="sm" onClick={() => enable()} disabled={busy} className="shrink-0"
      title="Get a notification the moment a customer messages">
      {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Bell className="w-4 h-4 mr-1.5" />}
      Alerts
    </Button>
  );
}

/**
 * WhatsApp only allows a free-form business reply within 24 hours of the customer's last
 * message. Past that the server delivers the same text by SMS instead — this says so up front,
 * rather than letting the send fail or silently change channel.
 */
function ReplyChannelHint({ window }: { window?: { isOpen: boolean; hoursLeft: number | null; openUntil: string | null } }) {
  if (!window || window.openUntil === null) {
    return <p className="text-xs text-slate-500 mt-2">Press Enter to send, Shift+Enter for new line</p>;
  }
  if (window.isOpen) {
    const h = window.hoursLeft ?? 0;
    const left = h >= 1 ? `${Math.round(h)}h` : `${Math.round(h * 60)}m`;
    return (
      <p className="text-xs text-slate-500 mt-2">
        Replying on WhatsApp · <span className="text-slate-400">{left} left in the reply window</span>
      </p>
    );
  }
  return (
    <p className="text-xs text-amber-700 mt-2">
      WhatsApp's 24-hour reply window has closed — this will send as a <b>text message</b> instead.
    </p>
  );
}
