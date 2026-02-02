<template>
	<div class="customer-drafts-container">
		<!-- Top Row: Customer Search (left) and Customer Group (right) - HORIZONTAL -->
		<v-row no-gutters align="center" class="customer-selection-row">
			<!-- Customer Search (Left side - larger ~65%) -->
			<v-col cols="8" sm="8" class="pr-2">
				<Skeleton v-if="loadingCustomers" height="40" class="w-100" />
				<v-autocomplete
					v-else
					ref="customerDropdown"
					class="customer-autocomplete-compact pos-themed-input"
					density="compact"
					clearable
					variant="solo"
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
							class="icon-button small-icon"
							size="18"
							@mousedown.prevent.stop
							@click.stop="edit_customer"
						>
							mdi-account-edit
						</v-icon>
					</template>

					<!-- Add icon (right) -->
					<template #append-inner>
						<v-icon
							class="icon-button small-icon"
							size="18"
							@mousedown.prevent.stop
							@click.stop="new_customer"
						>
							mdi-plus
						</v-icon>
					</template>

					<!-- Dropdown display -->
					<template #item="{ props, item }">
						<v-list-item v-bind="props" density="compact">
							<v-list-item-subtitle v-if="item.raw.customer_name !== item.raw.name" class="text-caption">
								ID: {{ item.raw.name }}
							</v-list-item-subtitle>
							<v-list-item-subtitle v-if="item.raw.mobile_no" class="text-caption">
								{{ item.raw.mobile_no }}
							</v-list-item-subtitle>
						</v-list-item>
					</template>
				</v-autocomplete>
			</v-col>

			<!-- Customer Group Filter (Right side - smaller ~35%) -->
			<v-col cols="4" sm="4">
				<v-select
					v-model="selectedGroup"
					:items="customerGroupOptions"
					item-title="label"
					item-value="value"
					density="compact"
					variant="solo"
					color="primary"
					class="customer-group-select pos-themed-input"
					:label="__('Customer Group')"
					hide-details
					@update:modelValue="onGroupChange"
				>
				</v-select>
			</v-col>
		</v-row>

		<!-- Draft Cards Section (Below the search row) - HORIZONTAL SCROLL -->
		<div v-if="drafts.length > 0" class="drafts-section">
			<div class="drafts-scroll-container">
				<div class="drafts-cards-row">
					<div
						v-for="draft in drafts"
						:key="draft.name"
						class="draft-card"
						@click="loadDraft(draft)"
					>
						<div class="draft-card-content">
							<div class="draft-customer-name">{{ draft.customer_name || draft.customer || __('No Customer') }}</div>
						</div>
					</div>
				</div>
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
	gap: 6px;
}

.customer-selection-row {
	width: 100%;
}

.customer-autocomplete-compact {
	width: 100%;
	border-radius: 8px;
	background-color: var(--pos-input-bg);
}

.customer-autocomplete-compact :deep(.v-field) {
	min-height: 40px !important;
}

.customer-autocomplete-compact :deep(.v-field__input) {
	padding-top: 4px !important;
	padding-bottom: 4px !important;
	font-size: 0.875rem !important;
}

.customer-group-select {
	width: 100%;
	border-radius: 8px;
	background-color: var(--pos-input-bg);
}

.customer-group-select :deep(.v-field) {
	min-height: 40px !important;
}

.customer-group-select :deep(.v-field__input) {
	padding-top: 4px !important;
	padding-bottom: 4px !important;
	font-size: 0.875rem !important;
}

.icon-button {
	cursor: pointer;
	opacity: 0.7;
	transition: all 0.2s ease;
}

.icon-button:hover {
	opacity: 1;
	color: var(--v-theme-primary);
}

.small-icon {
	font-size: 18px !important;
}

/* Drafts Section Styles */
.drafts-section {
	background: var(--pos-card-bg, #1a1a1a);
	border-radius: 8px;
	padding: 8px 12px;
	margin-top: 4px;
}

.drafts-header {
	display: flex;
	align-items: center;
	margin-bottom: 8px;
	color: var(--pos-text-secondary, #888);
	font-size: 0.75rem;
	text-transform: uppercase;
	letter-spacing: 0.5px;
}

.drafts-title {
	font-weight: 500;
}

.drafts-scroll-container {
	overflow-x: auto;
	overflow-y: hidden;
	-webkit-overflow-scrolling: touch;
	scrollbar-width: thin;
	scrollbar-color: var(--v-theme-primary) transparent;
}

.drafts-scroll-container::-webkit-scrollbar {
	height: 4px;
}

.drafts-scroll-container::-webkit-scrollbar-track {
	background: transparent;
}

.drafts-scroll-container::-webkit-scrollbar-thumb {
	background: var(--v-theme-primary);
	border-radius: 2px;
}

.drafts-cards-row {
	display: flex;
	gap: 8px;
	padding-bottom: 4px;
}

.draft-card {
	flex-shrink: 0;
	min-width: 120px;
	max-width: 150px;
	background: linear-gradient(135deg, #f5e642 0%, #d4c12a 100%);
	border-radius: 8px;
	padding: 10px 12px;
	cursor: pointer;
	transition: all 0.2s ease;
	box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.draft-card:hover {
	transform: translateY(-2px);
	box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}

.draft-card:active {
	transform: translateY(0);
}

.draft-card-content {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.draft-customer-name {
	font-weight: 600;
	font-size: 0.8rem;
	color: #1a1a1a;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.draft-amount {
	font-weight: 700;
	font-size: 0.85rem;
	color: #1a1a1a;
}

.draft-date {
	font-size: 0.7rem;
	color: rgba(26, 26, 26, 0.7);
}

/* Responsive styles */
@media (max-width: 600px) {
	.customer-selection-row {
		flex-direction: column;
		gap: 8px;
	}

	.customer-search-section,
	.customer-group-section {
		flex: 1;
		width: 100%;
		max-width: none;
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

		const onGroupChange = (group) => {
			selectedGroup.value = group;
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
			loadDraft,
			formatDate,
			selectFirstCustomer,
			openNewCustomer,
			focusCustomerSearch,
		};
	},
};
</script>
