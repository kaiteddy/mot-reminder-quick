
import { useState, useEffect } from "react"
import { getManufacturerLogo } from "@/lib/manufacturer-logos"
import { cn } from "@/lib/utils"

interface ManufacturerLogoProps {
    make: string | null | undefined
    size?: "sm" | "md" | "lg" | "xl"
    className?: string
    showName?: boolean
}

const sizeClasses = {
    sm: "h-8 w-8",
    md: "h-12 w-12",
    lg: "h-16 w-16",
    xl: "h-20 w-20"
}

const textSizeClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
    xl: "text-lg"
}

export function ManufacturerLogo({
    make,
    size = "md",
    className,
    showName = false
}: ManufacturerLogoProps) {
    const [imageError, setImageError] = useState(false)
    const [imageLoaded, setImageLoaded] = useState(false)
    const logoInfo = getManufacturerLogo(make)

    const shouldShowFallback = !logoInfo.logoUrl || imageError

    if (shouldShowFallback) {
        return (
            <div className={cn("flex items-center gap-2", className)}>
                <div
                    className={cn(
                        "rounded-full flex items-center justify-center text-white font-bold shadow-sm shrink-0",
                        sizeClasses[size],
                        textSizeClasses[size]
                    )}
                    style={{ backgroundColor: logoInfo.fallbackColor }}
                >
                    {logoInfo.name.charAt(0).toUpperCase()}
                </div>
                {showName && (
                    <span className={cn("font-medium", textSizeClasses[size])}>
                        {logoInfo.name}
                    </span>
                )}
            </div>
        )
    }

    return (
        <div className={cn("flex items-center gap-2", className)}>
            <div className={cn("relative shrink-0", sizeClasses[size])}>
                {!imageLoaded && (
                    <div
                        className={cn(
                            "absolute inset-0 rounded-full flex items-center justify-center text-white font-bold shadow-sm",
                            textSizeClasses[size]
                        )}
                        style={{ backgroundColor: logoInfo.fallbackColor }}
                    >
                        {logoInfo.name.charAt(0).toUpperCase()}
                    </div>
                )}

                <img
                    src={logoInfo.logoUrl}
                    alt={`${logoInfo.name} logo`}
                    className={cn(
                        "object-contain bg-white rounded-lg p-1 border border-gray-200 transition-opacity",
                        sizeClasses[size],
                        imageLoaded ? "opacity-100" : "opacity-0"
                    )}
                    onError={() => {
                        setImageError(true)
                        setImageLoaded(false)
                    }}
                    onLoad={() => {
                        setImageError(false)
                        setImageLoaded(true)
                    }}
                />
            </div>
            {showName && (
                <span className={cn("font-medium ml-1", textSizeClasses[size])}>
                    {logoInfo.name}
                </span>
            )}
        </div>
    )
}
