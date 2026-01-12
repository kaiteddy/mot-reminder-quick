import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_TITLE, APP_LOGO } from "@/const";
import { toast } from "sonner";

export default function Login() {
    const [, setLocation] = useLocation();
    const [password, setPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            const response = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
            });

            // Robustly handle non-JSON error responses (often from server crashes)
            const text = await response.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                if (!response.ok) {
                    throw new Error(`Server Error (${response.status}): ${text.substring(0, 100)}...`);
                }
                throw e; // Should not happen if response is OK but not JSON
            }

            if (!response.ok) {
                throw new Error(data.error || "Login failed");
            }

            toast.success("Welcome back!");
            window.location.href = "/";
        } catch (error: any) {
            console.error(error);
            toast.error(error.message);
            setIsLoading(false);
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-slate-50 dark:bg-slate-900">
            <Card className="w-full max-w-md mx-4">
                <CardHeader className="space-y-4 flex flex-col items-center text-center">
                    <img src={APP_LOGO} alt="App Logo" className="w-16 h-16 rounded-xl shadow-md" />
                    <div>
                        <CardTitle className="text-2xl">{APP_TITLE}</CardTitle>
                        <CardDescription>Enter admin password to continue</CardDescription>
                    </div>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div className="space-y-2">
                            <Input
                                type="password"
                                placeholder="Admin Password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <Button type="submit" className="w-full" disabled={isLoading}>
                            {isLoading ? "Signing in..." : "Sign In"}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
