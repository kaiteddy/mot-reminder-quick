import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCheck, Check, X, Clock, MessageCircle } from "lucide-react";
import { useState } from "react";
import { ChatHistory } from "./ChatHistory";

interface MessageDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  log: {
    id: number;
    customerName: string | null;
    registration: string | null;
    recipient: string;
    messageType: string;
    status: string;
    sentAt: Date;
    deliveredAt: Date | null;
    readAt: Date | null;
    failedAt: Date | null;
    errorMessage: string | null;
    messageContent: string | null;
    templateUsed: string | null;
  };
}

export function MessageDetailDialog({ open, onOpenChange, log }: MessageDetailDialogProps) {
  const [showChat, setShowChat] = useState(false);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "read":
        return <CheckCheck className="w-4 h-4 text-blue-500" />;
      case "delivered":
        return <CheckCheck className="w-4 h-4 text-slate-400" />;
      case "sent":
        return <Check className="w-4 h-4 text-slate-400" />;
      case "failed":
        return <X className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-slate-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "read":
        return "bg-blue-100 text-blue-700";
      case "delivered":
        return "bg-green-100 text-green-700";
      case "sent":
        return "bg-slate-100 text-slate-700";
      case "failed":
        return "bg-red-100 text-red-700";
      default:
        return "bg-slate-100 text-slate-700";
    }
  };

  const formatDateTime = (date: Date | null) => {
    if (!date) return "—";
    return new Date(date).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (showChat) {
    return (
      <Dialog open={open} onOpenChange={(isOpen) => {
        if (!isOpen) {
          setShowChat(false);
        }
        onOpenChange(isOpen);
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
          <ChatHistory
            phoneNumber={log.recipient}
            customerName={log.customerName || undefined}
            onClose={() => setShowChat(false)}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Message Details
            {getStatusIcon(log.status)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Customer Info */}
          <div className="bg-slate-50 rounded-lg p-4">
            <h3 className="font-semibold text-sm text-slate-700 mb-3">Customer Information</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-slate-500">Name:</span>
                <div className="font-medium">{log.customerName || "—"}</div>
              </div>
              <div>
                <span className="text-slate-500">Phone:</span>
                <div className="font-mono font-medium">{log.recipient}</div>
              </div>
              <div>
                <span className="text-slate-500">Vehicle:</span>
                <div className="font-mono font-medium">{log.registration || "—"}</div>
              </div>
              <div>
                <span className="text-slate-500">Type:</span>
                <Badge variant="outline" className="mt-1">
                  {log.messageType}
                </Badge>
              </div>
            </div>
          </div>

          {/* Message Content */}
          <div>
            <h3 className="font-semibold text-sm text-slate-700 mb-2">Message Content</h3>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <p className="text-sm text-slate-700 whitespace-pre-wrap">
                {log.messageContent || "Message content not available"}
              </p>
            </div>
            {log.templateUsed && (
              <p className="text-xs text-slate-500 mt-2">
                Template: <span className="font-mono">{log.templateUsed}</span>
              </p>
            )}
          </div>

          {/* Delivery Timeline */}
          <div>
            <h3 className="font-semibold text-sm text-slate-700 mb-3">Delivery Timeline</h3>
            <div className="space-y-3">
              {/* Sent */}
              <div className="flex items-start gap-3">
                <div className="mt-1">
                  <Check className="w-4 h-4 text-slate-400" />
                </div>
                <div className="flex-1">
                  <div className="font-medium text-sm">Sent</div>
                  <div className="text-xs text-slate-500">{formatDateTime(log.sentAt)}</div>
                </div>
                <Badge className={getStatusColor("sent")}>Sent</Badge>
              </div>

              {/* Delivered */}
              <div className="flex items-start gap-3">
                <div className="mt-1">
                  {log.deliveredAt ? (
                    <CheckCheck className="w-4 h-4 text-slate-400" />
                  ) : (
                    <Clock className="w-4 h-4 text-slate-300" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="font-medium text-sm">Delivered</div>
                  <div className="text-xs text-slate-500">{formatDateTime(log.deliveredAt)}</div>
                </div>
                {log.deliveredAt && (
                  <Badge className={getStatusColor("delivered")}>Delivered</Badge>
                )}
              </div>

              {/* Read */}
              <div className="flex items-start gap-3">
                <div className="mt-1">
                  {log.readAt ? (
                    <CheckCheck className="w-4 h-4 text-blue-500" />
                  ) : (
                    <Clock className="w-4 h-4 text-slate-300" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="font-medium text-sm">Read</div>
                  <div className="text-xs text-slate-500">{formatDateTime(log.readAt)}</div>
                </div>
                {log.readAt && <Badge className={getStatusColor("read")}>Read</Badge>}
              </div>

              {/* Failed */}
              {log.status === "failed" && (
                <div className="flex items-start gap-3">
                  <div className="mt-1">
                    <X className="w-4 h-4 text-red-500" />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm text-red-700">Failed</div>
                    <div className="text-xs text-red-600">
                      {formatDateTime(log.failedAt)}
                    </div>
                    {log.errorMessage && (
                      <div className="text-xs text-red-600 mt-1 bg-red-50 p-2 rounded">
                        {log.errorMessage}
                      </div>
                    )}
                  </div>
                  <Badge className={getStatusColor("failed")}>Failed</Badge>
                </div>
              )}
            </div>
          </div>

          {/* View Full Conversation */}
          <div className="border-t pt-4">
            <Button
              onClick={() => setShowChat(true)}
              variant="outline"
              className="w-full"
            >
              <MessageCircle className="w-4 h-4 mr-2" />
              View Full Conversation History
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
