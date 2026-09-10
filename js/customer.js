// ========== UTILITY FUNCTIONS ==========
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatPrice(price) {
    if (!price && price !== 0) return '۰';
    return new Intl.NumberFormat('fa-IR').format(price);
}

function formatDate(dateString) {
    if (!dateString) return '';
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('fa-IR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return dateString;
    }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ========== CUSTOMER CLASS ==========
class Customer {
    constructor(name, phone, presetId) {
        // اگه از قبل (با generateUniqueRandomId) یه id ساخته شده، همونو استفاده کن؛
        // وگرنه (fallback ایمن) یه id تصادفی موقت بساز
        this.id = presetId || Customer.generateFallbackId();
        this.name = name || '';
        this.phone = phone || '';
        this.notes = '';
        this.measurements = this.createEmptyMeasurements();
        this.models = {
            yakhun: [],
            sleeve: [],
            skirt: [],
            features: [],
            buttons: [],
            subOptions: {} // مثال: { sleeve: { "کفک": ["با پلت","گول"] }, features: { "جیب رو": ["انگلیسی"] } }
        };
        this.sewingPriceAfghani = null;
        this.deliveryDay = '';
        this.paymentReceived = false;
        this.paymentDate = null;
        this.orders = [];
        this.createdAt = new Date().toISOString();
        this.updatedAt = new Date().toISOString();
        this.deleted = false;
        this.version = 1;
    }

    // یک کد ۴ رقمی تصادفیِ یکتا از دیتابیس می‌گیره (شامل مشتری‌های حذف‌شده، تا هیچ‌وقت
    // با یه رکورد قدیمی تصادم نکنه و باعث جایگزین‌شدن/حذف اون نشه).
    // این تابع رو قبل از ساخت Customer جدید صدا بزن: `const id = await Customer.generateUniqueRandomId();`
    static async generateUniqueRandomId(maxAttempts = 50) {
        let existingIds = new Set();
        try {
            const all = await dbManager.getAllCustomers(true); // شامل حذف‌شده‌ها هم
            existingIds = new Set(all.map(c => String(c.id)));
        } catch (e) {
            // اگه دیتابیس در دسترس نبود، حداقل از لیست حافظه استفاده کن
            const list = (typeof customers !== 'undefined' && Array.isArray(customers)) ? customers : [];
            existingIds = new Set(list.map(c => String(c.id)));
        }

        for (let i = 0; i < maxAttempts; i++) {
            const candidate = String(Math.floor(1000 + Math.random() * 9000));
            if (!existingIds.has(candidate)) return candidate;
        }

        // اگه بعد از ۵۰ تلاش بازم تصادفی پیدا نشد (خیلی بعیده)، از timestamp استفاده کن
        return String(Date.now()).slice(-4);
    }

    // فقط یه fallback ایمن برای زمانی که Customer بدون id از قبل ساخته‌شده ساخته بشه
    // (نباید توی مسیر عادی افزودن مشتری اتفاق بیفته — submitAddCustomer از generateUniqueRandomId استفاده می‌کنه)
    static generateFallbackId() {
        return String(Math.floor(1000 + Math.random() * 9000)) + '-' + Math.floor(Math.random() * 10);
    }

    createEmptyMeasurements() {
        const measurements = {};
        AppConfig.MEASUREMENT_FIELDS.forEach(field => {
            measurements[field] = '';
        });
        return measurements;
    }

    validate() {
        const errors = [];
        
        if (!this.name || this.name.trim().length < 2) {
            errors.push('نام مشتری باید حداقل ۲ کاراکتر باشد');
        }
        
        if (!this.phone || this.phone.trim().length < 7 || !/^\d+$/.test(this.phone)) {
            errors.push('شماره تلفن باید حداقل ۷ رقم عددی باشد');
        }
        
        AppConfig.MEASUREMENT_FIELDS.forEach(field => {
            const value = this.measurements[field];
            if (value && isNaN(parseFloat(value))) {
                errors.push(`فیلد ${field} باید عددی باشد`);
            }
        });
        
        if (this.sewingPriceAfghani && isNaN(parseInt(this.sewingPriceAfghani))) {
            errors.push('قیمت باید عددی باشد');
        }
        
        return errors;
    }

    toObject() {
        return {
            id: this.id,
            name: this.name,
            phone: this.phone,
            notes: this.notes,
            measurements: this.measurements,
            models: this.models,
            sewingPriceAfghani: this.sewingPriceAfghani,
            deliveryDay: this.deliveryDay,
            paymentReceived: this.paymentReceived,
            paymentDate: this.paymentDate,
            orders: this.orders,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            deleted: this.deleted,
            version: this.version
        };
    }

    // یک مقدار مدل قدیمی (رشته تکی، آرایه، یا خالی) رو به آرایه‌ی استاندارد تبدیل می‌کنه
    // این‌طوری مشتری‌های قدیمی که مدل‌هاشون تک‌انتخابی (رشته) ذخیره شده، همچنان درست نمایش داده می‌شن
    static normalizeModelArray(value) {
        if (Array.isArray(value)) return value.filter(Boolean);
        if (typeof value === 'string' && value.trim() !== '') return [value.trim()];
        return [];
    }

    // ساختار models رو کامل و یکدست می‌کنه (سازگار با رکوردهای قدیمی/ناقص)
    static normalizeModels(models) {
        const src = (models && typeof models === 'object') ? models : {};

        // سازگاری با نسخه‌ی قبلی‌تر که فقط sleeveSubOptions داشت (بدون دسته‌بندی نوع)
        let rawSubOptions = (src.subOptions && typeof src.subOptions === 'object') ? src.subOptions : {};
        if (src.sleeveSubOptions && typeof src.sleeveSubOptions === 'object' && !rawSubOptions.sleeve) {
            rawSubOptions = Object.assign({}, rawSubOptions, { sleeve: src.sleeveSubOptions });
        }

        // هر زیرگزینه رو به آرایه تبدیل کن (سازگاری با نسخه‌ی قبلی که تک‌انتخابی/رشته‌ای بود)
        const subOptions = {};
        Object.keys(rawSubOptions).forEach(type => {
            const perModel = rawSubOptions[type];
            if (!perModel || typeof perModel !== 'object') return;
            subOptions[type] = {};
            Object.keys(perModel).forEach(model => {
                subOptions[type][model] = Customer.normalizeModelArray(perModel[model]);
            });
        });

        return {
            yakhun: Customer.normalizeModelArray(src.yakhun),
            sleeve: Customer.normalizeModelArray(src.sleeve),
            skirt: Customer.normalizeModelArray(src.skirt),
            features: Customer.normalizeModelArray(src.features),
            buttons: Customer.normalizeModelArray(src.buttons),
            subOptions: subOptions
        };
    }

    // ساختار measurements رو با فیلدهای پیش‌فرض کامل می‌کنه، بدون از دست دادن مقادیر قبلی
    // (دقیقاً مثل normalizeModels — مشتری‌های قدیمی دست‌نخورده می‌مونن، فقط فیلدهای جدید اضافه می‌شن)
    static normalizeMeasurements(measurements) {
        const src = (measurements && typeof measurements === 'object') ? measurements : {};
        const result = {};
        AppConfig.MEASUREMENT_FIELDS.forEach(field => {
            result[field] = (src[field] !== undefined && src[field] !== null) ? src[field] : '';
        });
        return result;
    }

    static fromObject(obj) {
        if (!obj || typeof obj !== 'object') {
            return new Customer('', '');
        }
        
        const customer = new Customer(obj.name || '', obj.phone || '');
        
        // مهم: ID اصلی رو از دیتابیس بگیر — نه ID جدید تصادفی
        if (obj.id) customer.id = obj.id;
        
        Object.keys(obj).forEach(key => {
            if (key !== 'id' && key !== 'name' && key !== 'phone') {
                try {
                    customer[key] = obj[key];
                } catch (e) {}
            }
        });
        
        if (!Array.isArray(customer.orders)) customer.orders = [];
        customer.models = Customer.normalizeModels(customer.models);
        customer.measurements = Customer.normalizeMeasurements(customer.measurements);
        
        AppConfig.MEASUREMENT_FIELDS.forEach(field => {
            if (customer.measurements[field] && typeof customer.measurements[field] === 'string') {
                const numValue = parseFloat(customer.measurements[field]);
                if (!isNaN(numValue)) {
                    customer.measurements[field] = numValue;
                }
            }
        });
        
        if (customer.sewingPriceAfghani && typeof customer.sewingPriceAfghani === 'string') {
            const priceValue = parseInt(customer.sewingPriceAfghani);
            if (!isNaN(priceValue)) {
                customer.sewingPriceAfghani = priceValue;
            }
        }
        
        return customer;
    }
}