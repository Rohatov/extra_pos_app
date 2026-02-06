<template>
	<div class="customer-drafts-container">
		<!-- Row 1: Customer Search and Customer Group side by side -->
		<div class="customer-selection-row">
			<!-- Guest Button -->
			<div class="guest-button-section" style="margin-right: 8px;">
				<v-btn
					color="primary"
					density="comfortable"
					variant="tonal"
					class="guest-btn"
					@click="setGuestCustomer"
					:disabled="effectiveReadonly || loadingCustomers"
					prepend-icon="mdi-account"
					style="height: 44px; min-width: 110px;"
				>
					{{ __('Guest') }}
				</v-btn>
			</div>

			<!-- Customer Search -->
			<div class="customer-search-section">
				<Skeleton v-if="loadingCustomers" height="44" class="w-100" />
				<v-autocomplete
					v-else
					ref="customerDropdown"
					class="customer-autocomplete-compact pos-themed-input"
					density="comfortable"
					clearable
					variant="outlined"
					color="primary"
					:label="frappe._('Customer search')"
					v-model="internalCustomer"
					:items="displayCustomers"
					item-title="customer_name"
					item-value="name"
					:no-data-text="
						isCustomerBackgroundLoading ? __('Loading...') : __('No customers found')
					"
					hide-details
					:customFilter="() => true"
					:disabled="effectiveReadonly || loadingCustomers"
					:menu-props="{ closeOnContentClick: false }"
					@update:menu="onCustomerMenuToggle"
					@update:modelValue="onCustomerChange"
					@update:search="onCustomerSearch"
					@keydown.enter="handleEnter"
				>
					<!-- Edit icon (left) -->
					<template #prepend-inner>
						<v-icon
							class="icon-button"
							size="20"
							@mousedown.prevent.stop
							@click.stop="edit_customer"
							title="Edit customer"
						>
							mdi-account-edit
						</v-icon>
					</template>

					<!-- Add icon (right) -->
					<template #append-inner>
						<v-icon
							class="icon-button"
							size="20"
							@mousedown.prevent.stop
							@click.stop="new_customer"
							title="Add new customer"
						>
							mdi-plus-circle
						</v-icon>
					</template>

					<!-- Dropdown display -->
					<template #item="{ props, item }">
						<v-list-item v-bind="props" class="customer-list-item">
							<template #subtitle>
								<div class="customer-item-details">
									<span v-if="item.raw.customer_name !== item.raw.name" class="customer-id">
										ID: {{ item.raw.name }}
									</span>
									<span v-if="item.raw.mobile_no" class="customer-mobile">
										📱 {{ item.raw.mobile_no }}
									</span>
									<span v-if="item.raw.customer_group" class="customer-group-badge">
										{{ item.raw.customer_group }}
									</span>
								</div>
							</template>
						</v-list-item>
					</template>
				</v-autocomplete>
			</div>

			<!-- Customer Group Filter -->
			<div class="customer-group-section">
				<v-select
					v-model="selectedGroup"
					:items="customerGroupOptions"
					item-title="label"
					item-value="value"
					density="comfortable"
					variant="outlined"
					color="primary"
					class="customer-group-select pos-themed-input"
					:label="__('Customer Group')"
					hide-details
					@update:modelValue="onGroupChange"
				>
				</v-select>
			</div>
		</div>

		<!-- Row 2: Draft Cards - only shown when drafts exist -->
		<div v-if="drafts.length > 0" class="drafts-row">
			<div
				v-for="draft in drafts"
				:key="draft.name"
				class="draft-card"
				@click="loadDraft(draft)"
				:title="draft.customer_name || draft.customer || __('No Customer')"
			>
				{{ draft.customer_name || draft.customer || __('No Customer') }}
			</div>
		</div>

		<!-- Update customer modal -->
		<UpdateCustomer />
	</div>
</template>

<style scoped>
.customer-drafts-container {
	width: 100%;
	display: flex;
	flex-direction: column;
	gap: 12px;
	overflow: visible;
}

/* Row 1: Customer search + Customer Group */
.customer-selection-row {
	display: flex;
	gap: 16px;
	align-items: flex-start;
	width: 100%;
	overflow: visible;
}

.guest-button-section {
	flex: 0 0 auto;
	display: flex;
	align-items: center;
}

.guest-btn {
	height: 44px;
	min-width: 110px;
	font-weight: 600;
	text-transform: none;
}

.customer-search-section {
	flex: 1;
	min-width: 0;
	overflow: visible;
}

.customer-group-section {
	flex: 0 0 220px;
	overflow: visible;
}

.customer-autocomplete-compact,
.customer-group-select {
	width: 100%;
}

/* Clear distinct borders for inputs */
.customer-autocomplete-compact :deep(.v-field) {
	border-radius: 6px !important;
	border: 2px solid rgba(255, 255, 255, 0.4) !important;
	background: rgba(255, 255, 255, 0.05) !important;
	min-height: 48px !important;
}

.customer-autocomplete-compact :deep(.v-field:hover) {
	border-color: rgba(255, 255, 255, 0.6) !important;
}

.customer-autocomplete-compact :deep(.v-field--focused) {
	border-color: var(--v-theme-primary) !important;
}

.customer-group-select :deep(.v-field) {
	border-radius: 6px !important;
	border: 2px solid rgba(255, 255, 255, 0.4) !important;
	background: rgba(255, 255, 255, 0.05) !important;
	min-height: 48px !important;
}

.customer-group-select :deep(.v-field:hover) {
	border-color: rgba(255, 255, 255, 0.6) !important;
}

.customer-group-select :deep(.v-field--focused) {
	border-color: var(--v-theme-primary) !important;
}

.icon-button {
	cursor: pointer;
	opacity: 0.7;
	transition: all 0.2s ease;
}

.icon-button:hover {
	opacity: 1;
	transform: scale(1.1);
}

/* Customer dropdown item styles */
.customer-list-item {
	padding: 8px 16px !important;
}

.customer-item-details {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-top: 4px;
	font-size: 0.8rem;
}

.customer-id {
	color: var(--pos-text-secondary, #888);
}

.customer-mobile {
	color: var(--pos-text-secondary, #888);
}

.customer-group-badge {
	background: var(--v-theme-primary);
	color: white;
	padding: 2px 8px;
	border-radius: 12px;
	font-size: 0.7rem;
	font-weight: 500;
}

/* Row 2: Draft Cards */
.drafts-row {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	padding: 10px 0;
	margin-top: 4px;
	border-top: 1px solid rgba(255, 255, 255, 0.15);
}

.draft-card {
	background: rgba(255, 255, 255, 0.08);
	border: 1px solid rgba(255, 255, 255, 0.25);
	border-radius: 6px;
	padding: 8px 16px;
	cursor: pointer;
	font-weight: 500;
	font-size: 0.85rem;
	color: inherit;
	transition: all 0.2s ease;
	white-space: nowrap;
}

.draft-card:hover {
	background: rgba(255, 255, 255, 0.15);
	border-color: var(--v-theme-primary);
}

.draft-card:active {
	transform: scale(0.98);
}

/* Responsive */
@media (max-width: 600px) {
	.customer-selection-row {
		flex-direction: column;
		gap: 12px;
	}

	.customer-group-section {
		flex: 1;
		width: 100%;
	}
}
</style>

<script>
/* global frappe __ */
import { ref, computed, watch, onMounted, onBeforeUnmount, getCurrentInstance, nextTick } from "vue";
import { storeToRefs } from "pinia";
import _ from "lodash";
import UpdateCustomer from "./UpdateCustomer.vue";
import Skeleton from "../ui/Skeleton.vue";
import { useCustomersStore } from "../../stores/customersStore.js";
import { clearCustomerStorage, setCustomersLastSync } from "../../../offline/index.js";
import format from "../../format";

export default {
	name: "CustomerSelectorWithDrafts",
	props: {
		pos_profile: Object,
		drafts: {
			type: Array,
			default: () => [],
		},
	},
	components: {
		UpdateCustomer,
		Skeleton,
	},
	mixins: [format],
	emits: ["load-draft"],
	setup(props, { emit, expose }) {
		const { proxy } = getCurrentInstance();
		const eventBus = proxy?.eventBus;
		const customersStore = useCustomersStore();
		const {
			customers,
			filteredCustomers,
			loadingCustomers,
			isCustomerBackgroundLoading,
			selectedCustomer,
			customerInfo,
		} = storeToRefs(customersStore);

		const internalCustomer = ref(null);
		const tempSelectedCustomer = ref(null);
		const isMenuOpen = ref(false);
		const customerDropdown = ref(null);
		const readonlyState = ref(false);
		const selectedGroup = ref("all");
		const customerGroups = ref([]);

		const effectiveReadonly = computed(() => readonlyState.value && navigator.onLine);

		// Customer groups options
		const customerGroupOptions = computed(() => {
			const options = [{ label: __("All Groups"), value: "all" }];
			if (customerGroups.value && customerGroups.value.length) {
				customerGroups.value.forEach((group) => {
					options.push({ label: group, value: group });
				});
			}
			return options;
		});

		// Filter customers by selected group
		const displayCustomers = computed(() => {
			const allCustomers = filteredCustomers.value || customers.value || [];
			
			if (selectedGroup.value === "all") {
				return allCustomers;
			}
			return allCustomers.filter(
				(c) => c.customer_group === selectedGroup.value
			);
		});

		const searchDebounce = _.debounce((term) => {
			customersStore.queueSearch(term || "");
		}, 300);

		watch(
			selectedCustomer,
			(value) => {
				if (!isMenuOpen.value) {
					internalCustomer.value = value || null;
				}
			},
			{ immediate: true },
		);

		watch(
			() => props.pos_profile,
			(profile) => {
				if (profile) {
					customersStore.setPosProfile(profile);
					loadCustomerGroups(profile);
				}
			},
			{ immediate: true },
		);

		const loadCustomerGroups = async (profile) => {
			if (!profile) return;
			
			try {
				// Get customer groups from POS profile
				if (profile.customer_groups && profile.customer_groups.length) {
					customerGroups.value = profile.customer_groups.map(
						(g) => g.customer_group
					);
				} else {
					// Fallback: fetch all customer groups
					const result = await frappe.call({
						method: "frappe.client.get_list",
						args: {
							doctype: "Customer Group",
							fields: ["name"],
							filters: { is_group: 0 },
							limit_page_length: 0,
						},
					});
					if (result && result.message) {
						customerGroups.value = result.message.map((g) => g.name);
					}
				}
			} catch (err) {
				console.error("Failed to load customer groups:", err);
			}
		};

		const onGroupChange = async (group) => {
			selectedGroup.value = group;
			
			// Check if customers have customer_group field
			const allCustomers = customers.value || [];
			if (allCustomers.length > 0 && !allCustomers[0].customer_group) {
				console.log("Customer group field missing - clearing cache and reloading...");
				// Clear old cache that doesn't have customer_group
				await clearCustomerStorage();
				setCustomersLastSync(null);
				// Reload customers from server
				await customersStore.get_customer_names();
			}
			
			// Reset customer search when group changes
			customersStore.searchCustomers("");
		};

		const onCustomerMenuToggle = (isOpen) => {
			isMenuOpen.value = isOpen;
			if (isOpen) {
				internalCustomer.value = null;
				return;
			}

			if (tempSelectedCustomer.value) {
				internalCustomer.value = tempSelectedCustomer.value;
				customersStore.setSelectedCustomer(tempSelectedCustomer.value);
			} else if (selectedCustomer.value) {
				internalCustomer.value = selectedCustomer.value;
			}
			tempSelectedCustomer.value = null;
		};

		const closeCustomerMenu = () => {
			const dropdown = customerDropdown.value;
			if (dropdown) {
				try {
					dropdown.menu = false;
				} catch (err) {
					dropdown.$emit?.("update:menu", false);
				}
				const inputEl = dropdown.$el?.querySelector("input");
				if (inputEl) {
					inputEl.blur();
				}
			}
			isMenuOpen.value = false;
		};

		const onCustomerChange = (val) => {
			if (val && val === selectedCustomer.value) {
				internalCustomer.value = selectedCustomer.value;
				eventBus?.emit("show_message", {
					title: __("Customer already selected"),
					color: "error",
				});
				return;
			}

			tempSelectedCustomer.value = val;

			if (isMenuOpen.value && val) {
				closeCustomerMenu();
			} else if (!isMenuOpen.value && val) {
				customersStore.setSelectedCustomer(val);
			}
		};

		const onCustomerSearch = (value) => {
			const term = value || "";
			if (isCustomerBackgroundLoading.value) {
				customersStore.queueSearch(term);
				return;
			}
			searchDebounce(term);
		};

		const handleEnter = (event) => {
			const inputText = event.target.value?.toLowerCase() || "";
			const allCustomers = displayCustomers.value || [];
			const matched = allCustomers.find((cust) => {
				return (
					cust.customer_name?.toLowerCase().includes(inputText) ||
					cust.name?.toLowerCase().includes(inputText)
				);
			});

			if (!matched) {
				return;
			}

			tempSelectedCustomer.value = matched.name;
			internalCustomer.value = matched.name;
			customersStore.setSelectedCustomer(matched.name);
			closeCustomerMenu();
			if (event?.target?.blur) {
				event.target.blur();
			}
		};

		const new_customer = () => {
			eventBus?.emit("open_update_customer", null);
		};

		const edit_customer = () => {
			eventBus?.emit("open_update_customer", customerInfo.value || {});
		};

		const setGuestCustomer = async () => {
			const guestCustomerName = "Guest Customer";
			
			try {
				// First check if guest customer exists in the loaded customers list
				const allCustomers = customers.value || [];
				let guestCustomer = allCustomers.find(
					(c) => c.name === guestCustomerName || c.customer_name === guestCustomerName
				);
				
				// If not in list, fetch from backend
				if (!guestCustomer) {
					const response = await frappe.call({
						method: "frappe.client.get",
						args: {
							doctype: "Customer",
							name: guestCustomerName,
						},
					});
					
					if (response && response.message) {
						guestCustomer = response.message;
						// Add to local customers list
						await customersStore.addOrUpdateCustomer(guestCustomer);
					}
				}
				
				if (guestCustomer) {
					// Set the guest customer using the name field
					const customerNameToSet = guestCustomer.name || guestCustomerName;
					internalCustomer.value = customerNameToSet;
					customersStore.setSelectedCustomer(customerNameToSet);
					
					// Emit set_customer event for other components
					eventBus?.emit("set_customer", customerNameToSet);
					
					// Close menu if open
					if (isMenuOpen.value) {
						closeCustomerMenu();
					}
					
					// Show confirmation message
					eventBus?.emit("show_message", {
						text: __("Guest Customer selected"),
						color: "success",
					});
				} else {
					// Guest customer not found
					eventBus?.emit("show_message", {
						text: __("Guest Customer not found. Please create it first."),
						color: "error",
					});
				}
			} catch (error) {
				console.error("Error setting guest customer:", error);
				eventBus?.emit("show_message", {
					text: __("Error selecting Guest Customer"),
					color: "error",
				});
			}
		};

		const loadDraft = (draft) => {
			emit("load-draft", draft);
		};

		const formatDate = (date) => {
			if (!date) return "";
			try {
				const d = new Date(date);
				return d.toLocaleDateString();
			} catch (e) {
				return date;
			}
		};

		const selectFirstCustomer = () => {
			const list = displayCustomers.value;
			if (!list || !list.length) {
				return;
			}

			const first = list[0];
			tempSelectedCustomer.value = first.name;
			internalCustomer.value = first.name;
			customersStore.setSelectedCustomer(first.name);
			closeCustomerMenu();
		};

		const openNewCustomer = () => {
			new_customer();
		};

		const focusCustomerSearch = async () => {
			const dropdown = customerDropdown.value;
			if (!dropdown) {
				return;
			}

			try {
				dropdown.menu = true;
			} catch (err) {
				dropdown.$emit?.("update:menu", true);
			}

			isMenuOpen.value = true;

			if (typeof dropdown.focus === "function") {
				dropdown.focus();
			}

			await nextTick();

			const inputEl = dropdown.$el?.querySelector("input");
			if (inputEl) {
				inputEl.focus();
				inputEl.select?.();
			}
		};

		expose({ focusCustomerSearch, selectFirstCustomer, openNewCustomer });

		const busHandlers = [];

		const registerBus = (event, handler) => {
			if (eventBus && typeof eventBus.on === "function") {
				eventBus.on(event, handler);
				busHandlers.push({ event, handler });
			}
		};

		onMounted(async () => {
			await customersStore.searchCustomers("");

			registerBus("register_pos_profile", async (data) => {
				customersStore.setPosProfile(data);
				await customersStore.get_customer_names();
				if (data.pos_profile) {
					loadCustomerGroups(data.pos_profile);
				}
			});

			registerBus("payments_register_pos_profile", async (data) => {
				customersStore.setPosProfile(data);
				await customersStore.get_customer_names();
			});

			registerBus("set_customer", (customer) => {
				customersStore.setSelectedCustomer(customer);
				internalCustomer.value = customer || null;
			});

			registerBus("add_customer_to_list", async (customer) => {
				await customersStore.addOrUpdateCustomer(customer);
				internalCustomer.value = customer?.name || null;
			});

			registerBus("set_customer_readonly", (value) => {
				readonlyState.value = Boolean(value);
			});

			registerBus("set_customer_info_to_edit", (data) => {
				customersStore.setCustomerInfo(data || {});
			});
		});

		onBeforeUnmount(() => {
			busHandlers.forEach(({ event, handler }) => {
				eventBus?.off(event, handler);
			});
			searchDebounce.cancel();
		});

		return {
			customerDropdown,
			filteredCustomers,
			displayCustomers,
			loadingCustomers,
			isCustomerBackgroundLoading,
			internalCustomer,
			effectiveReadonly,
			selectedGroup,
			customerGroupOptions,
			onGroupChange,
			onCustomerMenuToggle,
			onCustomerChange,
			onCustomerSearch,
			handleEnter,
			new_customer,
			edit_customer,
			setGuestCustomer,
			loadDraft,
			formatDate,
			selectFirstCustomer,
			openNewCustomer,
			focusCustomerSearch,
		};
	},
};
</script>
