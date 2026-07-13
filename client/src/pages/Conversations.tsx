import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Send, CheckCircle2, Clock, Eye, XCircle, Search, BellOff, Bell, CalendarPlus, Car, Wrench, ExternalLink, ShieldCheck, CalendarClock } from "lucide-react";
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
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
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

  const sendReplyMutation = trpc.conversations.sendReply.useMutation({
    onSuccess: () => {
      toast.success("Message sent successfully");
      setReplyMessage("");
      refetchMessages();
      refetchThreads();
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
      <div className="h-[calc(100vh-8rem)] flex flex-col bg-slate-50 border rounded-lg overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b px-6 py-4">
          <h1 className="text-2xl font-bold text-slate-900">Conversations</h1>
          <p className="text-sm text-slate-600 mt-1">
            WhatsApp-style message threads with customers
          </p>
        </div>

        <div className="flex-1 flex overflow-hidden @container">
          {/* Conversation List Sidebar */}
          <div className="w-72 @5xl:w-80 @6xl:w-96 bg-white border-r flex flex-col shrink-0">
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
          <div className="flex-1 flex flex-col bg-slate-50">
            {selectedThread ? (
              <>
                {/* Conversation Header */}
                <div className="bg-white border-b px-6 py-4 flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold text-lg text-slate-900 flex items-center gap-2 flex-wrap">
                      <span className="truncate">{selectedThread.customerName}</span>
                      {selectedThread.optedOut && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 shrink-0">
                          <BellOff className="w-3 h-3" /> Reminders stopped
                        </span>
                      )}
                    </h2>
                    <div className="flex items-center gap-3 text-sm text-slate-600 mt-1 min-w-0">
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
                  <div className="flex items-center gap-2 shrink-0">
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
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
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
                          "max-w-[70%] rounded-lg px-4 py-2 shadow-sm",
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
                          {message.type === "sent" && message.status && (
                            <span className="ml-1">{getStatusIcon(message.status)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                {/* Reply Input */}
                <div className="bg-white border-t p-4">
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
                      className="flex-1"
                    />
                    <Button
                      onClick={handleSendReply}
                      disabled={!replyMessage.trim() || sendReplyMutation.isPending}
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    Press Enter to send, Shift+Enter for new line
                  </p>
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
                        <span className="text-xs text-slate-400">#{h.docNo}</span>
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
