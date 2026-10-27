console.log("AgriConnect JavaScript loaded!");

function restoreCart() {
    try {
        const savedCart = JSON.parse(
            sessionStorage.getItem("agriconnectCart") || "[]"
        );

        if (!Array.isArray(savedCart)) return new Map();

        return new Map(savedCart
            .filter(item =>
                item &&
                Number.isSafeInteger(Number(item.produce_id)) &&
                Number(item.produce_id) > 0 &&
                typeof item.name === "string" &&
                Number.isFinite(Number(item.price)) &&
                Number(item.price) > 0 &&
                Number.isSafeInteger(Number(item.available)) &&
                Number(item.available) > 0 &&
                Number.isSafeInteger(Number(item.quantity)) &&
                Number(item.quantity) > 0 &&
                Number(item.quantity) <= Number(item.available)
            )
            .map(item => [Number(item.produce_id), {
                produce_id: Number(item.produce_id),
                name: item.name,
                price: Number(item.price),
                available: Number(item.available),
                quantity: Number(item.quantity)
            }]));
    } catch (error) {
        console.error("Could not restore the shopping cart:", error);
        sessionStorage.removeItem("agriconnectCart");
        return new Map();
    }
}

const cart = restoreCart();
const currencyFormatter = new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

function showMessage(element, message, color) {
    if (!element) return;

    element.textContent = message;
    element.style.color = color || "";
}

async function apiRequest(url, options = {}) {
    const response = await fetch(url, options);
    let result;

    try {
        result = await response.json();
    } catch (error) {
        throw new Error("The server returned an invalid response.");
    }

    if (!response.ok) {
        throw new Error(result.message || "The request could not be completed.");
    }

    return result;
}

function getToken() {
    const token = sessionStorage.getItem("agriconnectToken");

    if (!token) {
        throw new Error("Please log in again.");
    }

    return token;
}

function authenticatedHeaders() {
    return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${getToken()}`
    };
}

const registerForm = document.getElementById("registerForm");

if (registerForm) {
    registerForm.addEventListener("submit", async event => {
        event.preventDefault();

        const message = document.getElementById("message");
        const button = registerForm.querySelector('button[type="submit"]');

        button.disabled = true;
        showMessage(message, "Registering...");

        try {
            const result = await apiRequest("/api/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: document.getElementById("name").value.trim(),
                    email: document.getElementById("email").value.trim(),
                    password: document.getElementById("password").value,
                    role: document.getElementById("role").value
                })
            });

            showMessage(message, result.message, "green");
            registerForm.reset();
        } catch (error) {
            showMessage(message, error.message, "red");
        } finally {
            button.disabled = false;
        }
    });
}

const loginForm = document.getElementById("loginForm");

if (loginForm) {
    loginForm.addEventListener("submit", async event => {
        event.preventDefault();

        const message = document.getElementById("loginMessage");
        const button = loginForm.querySelector('button[type="submit"]');
        button.disabled = true;
        showMessage(message, "Logging in...");

        try {
            const result = await apiRequest("/api/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: document.getElementById("loginEmail").value.trim(),
                    password: document.getElementById("loginPassword").value
                })
            });

            sessionStorage.setItem("agriconnectToken", result.token);
            sessionStorage.setItem(
                "agriconnectUser",
                JSON.stringify(result.user)
            );
            loginForm.reset();
            showMessage(message, `Welcome, ${result.user.name}!`, "green");
            showDashboard(result.user);
        } catch (error) {
            showMessage(message, error.message, "red");
        } finally {
            button.disabled = false;
        }
    });
}

function showDashboard(user) {
    const dashboard = document.getElementById("dashboard");

    if (!dashboard) {
        console.error("Dashboard section is missing from index.html.");
        return;
    }

    const isFarmer = user.role === "farmer";
    const loginSection = document.getElementById("login");
    const registerSection = document.getElementById("register");

    if (loginSection) loginSection.hidden = true;
    if (registerSection) registerSection.hidden = true;

    dashboard.hidden = false;
    dashboard.innerHTML = `
        <h2>Welcome, ${escapeHTML(user.name)}!</h2>
        <p>Account type: ${isFarmer ? "Farmer" : "Buyer"}</p>
        ${
            isFarmer
                ? `
                    <h3>Farmer Dashboard</h3>
                    <p>List your produce for buyers. Orders are requests; arrange payment and delivery directly with the buyer.</p>
                    <form id="produceForm">
                        <input id="produceName" type="text" maxlength="100"
                            placeholder="Produce name (e.g. Tomatoes)" required>
                        <select id="produceCategory" required>
                            <option value="">Loading categories...</option>
                        </select>
                        <input id="producePrice" type="number" min="0.01"
                            step="0.01" placeholder="Price in KSh per unit" required>
                        <input id="produceQuantity" type="number" min="1"
                            step="1" placeholder="Quantity available" required>
                        <input id="produceLocation" type="text" maxlength="150"
                            placeholder="Farm location (optional)">
                        <button type="submit">Add Produce</button>
                    </form>
                    <p id="produceMessage" role="status"></p>
                    <h3>Your Produce Listings</h3>
                    <div id="farmerProduce"></div>
                    <h3>Orders for Your Produce</h3>
                    <div id="farmerOrders"></div>
                `
                : `
                    <h3>Buyer Dashboard</h3>
                    <p>Browse available farmer listings and place an order request.</p>
                    <button type="button" id="browseProduce">Browse Produce</button>
                `
        }
        <button type="button" id="logoutButton">Logout</button>
    `;

    const browseButton = document.getElementById("browseProduce");
    if (browseButton) {
        browseButton.addEventListener("click", () => {
            document.getElementById("produce").scrollIntoView({
                behavior: "smooth"
            });
        });
    }

    document.getElementById("logoutButton").addEventListener("click", () => {
        sessionStorage.removeItem("agriconnectToken");
        sessionStorage.removeItem("agriconnectUser");
        window.location.reload();
    });

    if (isFarmer) {
        setupProduceForm();
        loadFarmerProduce();
        loadFarmerOrders();
    }
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

async function setupProduceForm() {
    const form = document.getElementById("produceForm");
    if (!form) return;

    const categorySelect = document.getElementById("produceCategory");
    const message = document.getElementById("produceMessage");
    const submitButton = form.querySelector('button[type="submit"]');

    try {
        const categories = await apiRequest("/api/categories");
        categorySelect.replaceChildren(new Option("Select a category", ""));

        categories.forEach(category => {
            categorySelect.add(
                new Option(category.category_name, category.category_id)
            );
        });

        if (categories.length === 0) {
            categorySelect.replaceChildren(
                new Option("No categories available", "")
            );
            showMessage(
                message,
                "Add categories to the database before creating listings.",
                "red"
            );
            submitButton.disabled = true;
            return;
        }

        showMessage(message, "Categories loaded.");
    } catch (error) {
        categorySelect.replaceChildren(
            new Option("Could not load categories", "")
        );
        showMessage(message, error.message, "red");
        submitButton.disabled = true;
        return;
    }

    form.addEventListener("submit", async event => {
        event.preventDefault();
        submitButton.disabled = true;
        showMessage(message, "Saving produce...");

        try {
            const result = await apiRequest("/api/produce", {
                method: "POST",
                headers: authenticatedHeaders(),
                body: JSON.stringify({
                    name: document.getElementById("produceName").value.trim(),
                    category_id: categorySelect.value,
                    price: document.getElementById("producePrice").value,
                    quantity: document.getElementById("produceQuantity").value,
                    location: document.getElementById("produceLocation").value.trim()
                })
            });

            showMessage(message, result.message, "green");
            form.reset();
            await Promise.all([loadFarmerProduce(), loadProduceListings()]);
        } catch (error) {
            showMessage(message, error.message, "red");
        } finally {
            submitButton.disabled = false;
        }
    });
}

async function loadFarmerProduce() {
    const container = document.getElementById("farmerProduce");
    if (!container) return;

    container.textContent = "Loading your listings...";

    try {
        const products = await apiRequest("/api/my/produce", {
            headers: authenticatedHeaders()
        });

        container.replaceChildren();

        if (products.length === 0) {
            container.textContent = "You have not listed any produce yet.";
            return;
        }

        products.forEach(product => {
            const row = document.createElement("p");
            row.textContent =
                `${product.name} (${product.category_name}) — ` +
                `KSh ${currencyFormatter.format(Number(product.price))} per unit; ` +
                `${product.quantity} available`;
            container.append(row);
        });
    } catch (error) {
        container.textContent = error.message;
    }
}

async function loadFarmerOrders() {
    const container = document.getElementById("farmerOrders");
    if (!container) return;

    container.textContent = "Loading orders...";

    try {
        const orders = await apiRequest("/api/my/orders", {
            headers: authenticatedHeaders()
        });

        container.replaceChildren();

        if (orders.length === 0) {
            container.textContent = "There are no orders for your produce yet.";
            return;
        }

        orders.forEach(order => {
            const row = document.createElement("p");
            const contact = document.createElement("a");
            contact.href = `mailto:${encodeURIComponent(order.buyer_email)}`;
            contact.textContent = `${order.buyer_name} (${order.buyer_email})`;
            row.append(
                `Order #${order.order_id}: ${order.quantity} × ` +
                `${order.product_name} — KSh ` +
                `${currencyFormatter.format(Number(order.unit_price))} each; ` +
                `${order.status}. Contact buyer: `,
                contact
            );
            container.append(row);
        });
    } catch (error) {
        container.textContent = error.message;
    }
}

async function loadProduceListings() {
    const container = document.getElementById("products");
    const message = document.getElementById("catalogueMessage");
    if (!container) return;

    try {
        const products = await apiRequest("/api/produce");
        container.querySelectorAll("[data-listing]").forEach(card => card.remove());

        if (products.length === 0) {
            showMessage(message, "No farmer listings are currently available.");
            return;
        }

        showMessage(message, `${products.length} farmer listing(s) available.`);
        products.forEach(product => container.append(createProductCard(product)));
        filterProducts();
    } catch (error) {
        showMessage(message, error.message, "red");
    }
}

function createProductCard(product) {
    const card = document.createElement("article");
    card.className = "product";
    card.dataset.listing = "true";

    const title = document.createElement("h3");
    title.textContent = product.name;

    const description = document.createElement("p");
    description.textContent =
        `${product.category_name} · Sold by ${product.farmer_name}` +
        (product.location ? ` · ${product.location}` : "");

    const price = document.createElement("p");
    price.className = "price";
    price.textContent =
        `KSh ${currencyFormatter.format(Number(product.price))} per unit`;

    const stock = document.createElement("p");
    stock.textContent = `${product.quantity} available`;

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.addProduce = product.produce_id;
    button.addEventListener("click", () => addToCart(product));

    card.append(title, description, price, stock, button);
    updateProductButton(product.produce_id, button);
    return card;
}

function updateProductButton(produceId, button) {
    const item = cart.get(Number(produceId));
    button.textContent = item
        ? `Add to Cart (${item.quantity} selected)`
        : "Add to Cart";
}

function saveCart() {
    sessionStorage.setItem(
        "agriconnectCart",
        JSON.stringify([...cart.values()])
    );
}

function addToCart(product) {
    const existing = cart.get(product.produce_id);

    if (existing && existing.quantity >= Number(product.quantity)) {
        showMessage(
            document.getElementById("orderMessage"),
            "The cart already contains all available stock for this product.",
            "red"
        );
        return;
    }

    cart.set(product.produce_id, {
        produce_id: Number(product.produce_id),
        name: product.name,
        price: Number(product.price),
        available: Number(product.quantity),
        quantity: existing ? existing.quantity + 1 : 1
    });
    saveCart();
    showMessage(document.getElementById("orderMessage"), "");
    document.querySelectorAll("[data-add-produce]").forEach(button => {
        if (Number(button.dataset.addProduce) === Number(product.produce_id)) {
            updateProductButton(product.produce_id, button);
        }
    });
    renderCart();
}

function renderCart() {
    const itemsElement = document.getElementById("cartItems");
    const countElement = document.getElementById("count");
    const totalElement = document.getElementById("cartTotal");
    const checkoutButton = document.getElementById("checkout");
    if (!itemsElement) return;

    itemsElement.replaceChildren();
    let count = 0;
    let total = 0;

    cart.forEach(item => {
        count += item.quantity;
        total += item.price * item.quantity;

        const row = document.createElement("li");
        const text = document.createElement("span");
        text.textContent =
            `${item.name} — ${item.quantity} × KSh ` +
            `${currencyFormatter.format(item.price)} = KSh ` +
            `${currencyFormatter.format(item.price * item.quantity)} `;

        const decrease = document.createElement("button");
        decrease.type = "button";
        decrease.textContent = "−";
        decrease.setAttribute("aria-label", `Remove one ${item.name}`);
        decrease.addEventListener("click", () => changeCartQuantity(item, -1));

        const increase = document.createElement("button");
        increase.type = "button";
        increase.textContent = "+";
        increase.setAttribute("aria-label", `Add one ${item.name}`);
        increase.disabled = item.quantity >= item.available;
        increase.addEventListener("click", () => changeCartQuantity(item, 1));

        row.append(text, decrease, increase);
        itemsElement.append(row);
    });

    countElement.textContent = count;
    totalElement.textContent = `Total: KSh ${currencyFormatter.format(total)}`;
    checkoutButton.disabled = false;
}

function changeCartQuantity(item, difference) {
    const updatedQuantity = item.quantity + difference;

    if (updatedQuantity <= 0) {
        cart.delete(item.produce_id);
    } else if (updatedQuantity <= item.available) {
        item.quantity = updatedQuantity;
        cart.set(item.produce_id, item);
    }

    saveCart();
    document.querySelectorAll("[data-add-produce]").forEach(button => {
        if (Number(button.dataset.addProduce) === item.produce_id) {
            updateProductButton(item.produce_id, button);
        }
    });
    renderCart();
}

function filterProducts() {
    const searchInput = document.getElementById("search");
    if (!searchInput) return;

    const term = searchInput.value.toLowerCase();
    document.querySelectorAll(".product").forEach(product => {
        product.hidden = !product.textContent.toLowerCase().includes(term);
    });
}

const searchInput = document.getElementById("search");
if (searchInput) {
    searchInput.addEventListener("input", filterProducts);
}

const checkoutButton = document.getElementById("checkout");
if (checkoutButton) {
    checkoutButton.addEventListener("click", async () => {
        const message = document.getElementById("orderMessage");
        let user;

        try {
            user = JSON.parse(sessionStorage.getItem("agriconnectUser"));
        } catch (error) {
            showMessage(message, "Please log in as a buyer to place an order.", "red");
            return;
        }

        if (!user || user.role !== "buyer") {
            showMessage(message, "Log in with a buyer account to place an order.", "red");
            document.getElementById("login").scrollIntoView({ behavior: "smooth" });
            return;
        }

        if (cart.size === 0) {
            showMessage(message, "Your cart is empty.", "red");
            return;
        }

        checkoutButton.disabled = true;
        showMessage(message, "Placing your order...");

        try {
            const result = await apiRequest("/api/orders", {
                method: "POST",
                headers: authenticatedHeaders(),
                body: JSON.stringify({
                    items: [...cart.values()].map(item => ({
                        produce_id: item.produce_id,
                        quantity: item.quantity
                    }))
                })
            });

            cart.clear();
            saveCart();
            renderCart();
            await loadProduceListings();
            showMessage(
                message,
                `Order #${result.order_id} placed. Total: KSh ` +
                `${currencyFormatter.format(Number(result.total_amount))}. ` +
                "No payment was taken; arrange payment and delivery with the farmer.",
                "green"
            );
        } catch (error) {
            showMessage(message, error.message, "red");
            await loadProduceListings();
        } finally {
            checkoutButton.disabled = false;
        }
    });
}

renderCart();
loadProduceListings();

try {
    const savedUser = JSON.parse(sessionStorage.getItem("agriconnectUser"));
    if (savedUser && ["farmer", "buyer"].includes(savedUser.role)) {
        showDashboard(savedUser);
    }
} catch (error) {
    console.error("Could not restore the saved AgriConnect session:", error);
    sessionStorage.removeItem("agriconnectToken");
    sessionStorage.removeItem("agriconnectUser");
}
