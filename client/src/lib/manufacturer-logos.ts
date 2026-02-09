
/**
 * Manufacturer logo utilities
 * Returns logo URLs for vehicle manufacturers
 */

export interface ManufacturerLogo {
    name: string
    logoUrl: string
    fallbackColor: string
}

/**
 * Get manufacturer logo information
 * @param make - The vehicle manufacturer name
 * @returns Logo information or fallback
 */
export function getManufacturerLogo(make: string | null | undefined): ManufacturerLogo {
    if (!make) return getFallbackLogo("Unknown")

    const normalizedMake = make.toLowerCase().trim()

    // Map of manufacturer names to logo information
    const logoMap: Record<string, ManufacturerLogo> = {
        'ford': {
            name: 'Ford',
            logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/3e/Ford_logo_flat.svg',
            fallbackColor: '#003478'
        },
        'vauxhall': {
            name: 'Vauxhall',
            logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/8/81/Vauxhall_logo_2019.svg',
            fallbackColor: '#FF0000'
        },
        'volkswagen': {
            name: 'Volkswagen',
            logoUrl: 'https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/volkswagen.svg',
            fallbackColor: '#1E3A8A'
        },
        'bmw': {
            name: 'BMW',
            logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/4/44/BMW.svg',
            fallbackColor: '#0066CC'
        },
        'mercedes': {
            name: 'Mercedes-Benz',
            logoUrl: 'https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/mercedes.svg',
            fallbackColor: '#000000'
        },
        'mercedes-benz': {
            name: 'Mercedes-Benz',
            logoUrl: 'https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/mercedes.svg',
            fallbackColor: '#000000'
        },
        'audi': {
            name: 'Audi',
            logoUrl: 'https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/audi.svg',
            fallbackColor: '#BB0A30'
        },
        'toyota': {
            name: 'Toyota',
            logoUrl: 'https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/toyota.svg',
            fallbackColor: '#EB0A1E'
        },
        'honda': {
            name: 'Honda',
            logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/7/76/Honda_logo.svg',
            fallbackColor: '#E60012'
        },
        'nissan': {
            name: 'Nissan',
            logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/2/23/Nissan_2020_logo.svg',
            fallbackColor: '#C3002F'
        },
        'hyundai': {
            name: 'Hyundai',
            logoUrl: 'https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/hyundai.svg',
            fallbackColor: '#002C5F'
        },
        'kia': {
            name: 'Kia',
            logoUrl: 'https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/kia.svg',
            fallbackColor: '#05141F'
        },
        'peugeot': {
            name: 'Peugeot',
            logoUrl: 'https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/peugeot.svg',
            fallbackColor: '#1C4482'
        },
        'renault': {
            name: 'Renault',
            logoUrl: 'https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/renault.svg',
            fallbackColor: '#FFCC00'
        },
        'citroen': {
            name: 'Citroën',
            logoUrl: 'https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/citroen.svg',
            fallbackColor: '#B71234'
        },
        'fiat': {
            name: 'Fiat',
            logoUrl: 'https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/fiat.svg',
            fallbackColor: '#8D1538'
        },
        'mini': {
            name: 'MINI',
            logoUrl: 'https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/mini.svg',
            fallbackColor: '#000000'
        },
        'land rover': {
            name: 'Land Rover',
            logoUrl: 'https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/landrover.svg',
            fallbackColor: '#005A2B'
        },
        'jaguar': {
            name: 'Jaguar',
            logoUrl: 'https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/jaguar.svg',
            fallbackColor: '#0C121C'
        },
        'volvo': {
            name: 'Volvo',
            logoUrl: 'https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/volvo.svg',
            fallbackColor: '#003057'
        },
        'mazda': {
            name: 'Mazda',
            logoUrl: 'https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/mazda.svg',
            fallbackColor: '#B71234'
        }
    }

    if (logoMap[normalizedMake]) {
        return logoMap[normalizedMake]
    }

    for (const [key, logo] of Object.entries(logoMap)) {
        if (normalizedMake.includes(key) || key.includes(normalizedMake)) {
            return logo
        }
    }

    return getFallbackLogo(make)
}

export function getFallbackLogo(make: string): ManufacturerLogo {
    return {
        name: make,
        logoUrl: '',
        fallbackColor: '#6B7280'
    }
}
