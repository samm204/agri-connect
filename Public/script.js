
console.log("AgriConnect JavaScript loaded!");

// 1. Cart Counter
let cartCount = 0;

const cartButtons = document.querySelectorAll(".add-cart");
const countElement = document.getElementById("count");

if (countElement && cartButtons.length > 0) {
    cartButtons.forEach(button => {
        button.addEventListener("click", () => {
            cartCount++;
            countElement.textContent = cartCount;
        });
    });
}

// 2. Live Product Search Filter
const searchInput = document.getElementById("search");

if (searchInput) {
    searchInput.addEventListener("input", function () {
        const term = this.value.toLowerCase();

        document.querySelectorAll(".product").forEach(product => {
            product.style.display =
                product.textContent.toLowerCase().includes(term)
                    ? ""
                    : "none";
        });
    });
}

 // 3. Registration Form Handler

const registerForm = document.getElementById("registerForm");

if (registerForm) {
    registerForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        const message = document.getElementById("message");
        const button = registerForm.querySelector(
            'button[type="submit"]'
        );

        const name = document.getElementById("name").value.trim();
        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;
        const role = document.getElementById("role").value;

        message.textContent = "Registering your account...";
        message.style.color = "black";
        button.disabled = true;

        try {
            const response = await fetch("/api/register",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        name,
                        email,
                        password,
                        role
                    })
                }
            );

            const result = await response.json();

            if (!response.ok) {
                throw new Error(
                    result.message || "Registration failed."
                );
            }

            message.textContent =
                "Registration successful! You can now log in.";
            message.style.color = "green";

            registerForm.reset();

        } catch (error) {
            console.error("Registration error:", error);

            message.textContent =
                "Registration failed: " + error.message;
            message.style.color = "red";

        } finally {
            button.disabled = false;
        }
    });
}
