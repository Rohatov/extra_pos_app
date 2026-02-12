<!-- eslint-disable vue/multi-word-component-names -->
<template>
	<div class="pay-root">
		<!-- Main Payment Card -->
		<div class="pay-card pos-themed-card">
			<!-- Loading indicator -->
			<v-progress-linear
				:active="loading"
				:indeterminate="loading"
				absolute
				location="top"
				color="primary"
				height="3"
			></v-progress-linear>

			<div ref="paymentContainer" class="pay-scroll">
				<!-- ═══════════════════════════════════════════ -->
				<!-- SECTION: Payment Methods                   -->
				<!-- ═══════════════════════════════════════════ -->
				<div class="pay-section" v-if="is_cashback && invoice_doc && Array.isArray(invoice_doc.payments)">
					<div class="pay-section-title">
						<v-icon size="18" class="mr-2">mdi-credit-card-outline</v-icon>
						{{ __("Payment Methods") }}
					</div>

					<div class="pay-methods-grid">
						<div
							v-for="(payment, paymentIndex) in invoice_doc.payments"
							:key="payment.name || paymentIndex"
							class="pay-method-card"
							:class="{ 'pay-method-active': payment.amount > 0 }"
						>
							<!-- M-Pesa special card -->
							<template v-if="is_mpesa_c2b_payment(payment)">
								<div class="pay-method-header">
									<v-icon size="20" color="success" class="mr-2">mdi-cellphone</v-icon>
									<span class="pay-method-name">{{ payment.mode_of_payment }}</span>
								</div>
								<v-btn
									block
									color="success"
									variant="flat"
									rounded="lg"
									class="pay-method-action-btn mt-2"
									@click="mpesa_c2b_dialog(payment)"
								>
									<v-icon start size="18">mdi-cellphone-arrow-down</v-icon>
									{{ __("Get Payments") }}
								</v-btn>
							</template>

							<!-- Standard payment method card -->
							<template v-else>
								<div class="pay-method-header">
									<v-icon size="20" class="mr-2 pay-method-icon">
										{{ payment.type === 'Phone' ? 'mdi-cellphone' : (payment.mode_of_payment || '').toLowerCase().includes('cash') ? 'mdi-cash' : 'mdi-bank-transfer' }}
									</v-icon>
									<span class="pay-method-name">{{ payment.mode_of_payment }}</span>
									<v-btn
										size="small"
										variant="tonal"
										color="primary"
										rounded="lg"
										class="ml-auto pay-fill-btn"
										@click.stop="set_full_amount(paymentIndex)"
									>
										<v-icon size="16" start>mdi-check-circle-outline</v-icon>
										{{ __("Fill") }}
									</v-btn>
								</div>

								<div class="pay-method-input-wrap">
									<v-text-field
										density="compact"
										variant="outlined"
										color="primary"
										:label="frappe._('Amount')"
										class="pay-amount-input"
										hide-details
										:model-value="formatCurrency(payment.amount)"
										@change="handlePaymentAmountChange(payment, $event)"
										:rules="[isNumber]"
										:prefix="currencySymbol(invoice_doc.currency)"
										@focus="set_rest_amount(payment.idx)"
										:readonly="invoice_doc.is_return"
									></v-text-field>
								</div>

								<!-- Cash Denomination Buttons -->
								<div
									v-if="
										payment.default === 1 &&
										isCashLikePayment(payment) &&
										getVisibleDenominations(payment).length
									"
									class="pay-denominations"
								>
									<v-btn
										v-for="d in getVisibleDenominations(payment)"
										:key="d"
										size="small"
										variant="outlined"
										color="primary"
										rounded="lg"
										class="pay-denom-chip"
										@click="setPaymentToDenomination(payment, d)"
									>
										{{ formatCurrency(d) }}
									</v-btn>
								</div>

								<!-- Request Payment for Phone Type -->
								<v-btn
									v-if="payment.type === 'Phone' && payment.amount > 0 && request_payment_field"
									block
									color="success"
									variant="flat"
									rounded="lg"
									class="pay-method-action-btn mt-2"
									:disabled="payment.amount === 0"
									@click="request_payment(payment)"
								>
									<v-icon start size="18">mdi-send</v-icon>
									{{ __("Request") }}
								</v-btn>
							</template>
						</div>
					</div>
				</div>

				<!-- ═══════════════════════════════════════════ -->
				<!-- SECTION: Loyalty Points Redemption         -->
				<!-- ═══════════════════════════════════════════ -->
				<div
					class="pay-section"
					v-if="invoice_doc && available_points_amount > 0 && !invoice_doc.is_return"
				>
					<div class="pay-section-title">
						<v-icon size="18" class="mr-2">mdi-star-circle-outline</v-icon>
						{{ __("Loyalty Points") }}
					</div>
					<v-row dense>
						<v-col cols="7">
							<v-text-field
								density="compact"
								variant="outlined"
								color="primary"
								:label="frappe._('Redeem Loyalty Points')"
								class="pay-amount-input"
								hide-details
								:model-value="formatCurrency(loyalty_amount)"
								type="text"
								@change="setFormatedCurrency(this, 'loyalty_amount', null, false, $event)"
								:prefix="currencySymbol(invoice_doc.currency)"
							></v-text-field>
						</v-col>
						<v-col cols="5">
							<v-text-field
								density="compact"
								variant="outlined"
								color="primary"
								:label="
									frappe._('Available') +
									(customer_info.loyalty_points ? ` (${customer_info.loyalty_points} pts)` : '')
								"
								class="pay-amount-input"
								hide-details
								:model-value="formatFloat(available_points_amount)"
								:prefix="currencySymbol(invoice_doc.currency)"
								readonly
							></v-text-field>
						</v-col>
					</v-row>
				</div>



				<!-- ═══════════════════════════════════════════ -->
				<!-- SECTION: Payment Summary                   -->
				<!-- ═══════════════════════════════════════════ -->
				<div class="pay-section pay-summary-section" v-if="invoice_doc">
					<div class="pay-section-title">
						<v-icon size="18" class="mr-2">mdi-receipt-text-outline</v-icon>
						{{ __("Payment Summary") }}
					</div>

					<div class="pay-summary-block">
						<!-- Subtotal / Net Total -->
						<div class="pay-summary-row">
							<span class="pay-summary-label">{{ __("Subtotal") }}</span>
							<span class="pay-summary-value">
								{{ currencySymbol() }} {{ formatCurrency(invoice_doc.net_total, displayCurrency) }}
							</span>
						</div>

						<div class="pay-summary-divider"></div>

						<!-- Grand Total -->
						<div class="pay-summary-row pay-summary-grand">
							<span class="pay-summary-label">{{ __("Grand Total") }}</span>
							<span class="pay-summary-value">
								{{ currencySymbol(invoice_doc.currency) }} {{ formatCurrency(invoice_doc.grand_total) }}
							</span>
						</div>

						<!-- Rounded Total -->
						<div v-if="invoice_doc.rounded_total" class="pay-summary-row">
							<span class="pay-summary-label">{{ __("Rounded Total") }}</span>
							<span class="pay-summary-value">
								{{ currencySymbol(invoice_doc.currency) }} {{ formatCurrency(invoice_doc.rounded_total) }}
							</span>
						</div>

						<div class="pay-summary-divider"></div>

						<!-- Total Paid -->
						<div class="pay-summary-row pay-summary-paid" @click="showPaidAmount">
							<span class="pay-summary-label">
								<v-icon size="16" class="mr-1" color="success">mdi-check-circle</v-icon>
								{{ __("Total Paid") }}
							</span>
							<span class="pay-summary-value pay-value-success">
								{{ currencySymbol(invoice_doc.currency) }} {{ total_payments_display }}
							</span>
						</div>

						<!-- Outstanding / Change -->
						<div class="pay-summary-row pay-summary-outstanding">
							<span class="pay-summary-label">
								<v-icon size="16" class="mr-1" :color="diff_payment > 0 ? 'error' : 'success'">
									{{ diff_payment > 0 ? 'mdi-alert-circle' : 'mdi-cash-refund' }}
								</v-icon>
								{{ diff_payment > 0 ? __("Outstanding") : __("Change") }}
							</span>
							<span
								class="pay-summary-value"
								:class="diff_payment > 0 ? 'pay-value-error' : 'pay-value-success'"
							>
								{{ currencySymbol(invoice_doc.currency) }} {{ diff_payment_display }}
							</span>
						</div>


					</div>
				</div>

				<!-- ═══════════════════════════════════════════ -->
				<!-- SECTION: Options & Settings                -->
				<!-- ═══════════════════════════════════════════ -->
				<div class="pay-section pay-options-section" v-if="invoice_doc">
					<!-- Delivery Date (Sales Order) -->
					<v-row dense v-if="pos_profile.posa_allow_sales_order && invoiceType === 'Order'">
						<v-col cols="6">
							<VueDatePicker
								v-model="new_delivery_date"
								model-type="format"
								format="dd-MM-yyyy"
								:min-date="new Date()"
								auto-apply
								class="pay-amount-input pos-themed-input"
								@update:model-value="update_delivery_date()"
							/>
						</v-col>
					</v-row>

					<!-- Return Valid Until -->
					<v-row dense v-if="returnValidityEnabled && invoice_doc && !invoice_doc.is_return">
						<v-col cols="6">
							<VueDatePicker
								v-model="return_valid_upto_date"
								model-type="format"
								format="dd-MM-yyyy"
								:min-date="returnValidityMinDate"
								:enable-time-picker="false"
								auto-apply
								class="pay-amount-input pos-themed-input"
								:placeholder="frappe._('Return Valid Until')"
								@update:model-value="updateReturnValidUpto"
							/>
						</v-col>
					</v-row>

					<!-- Shipping Address -->
					<v-row dense v-if="invoice_doc && invoice_doc.posa_delivery_date">
						<v-col cols="12">
							<v-autocomplete
								density="compact"
								clearable
								auto-select-first
								variant="outlined"
								color="primary"
								:label="frappe._('Address')"
								v-model="invoice_doc.shipping_address_name"
								:items="addresses"
								item-title="display_title"
								item-value="name"
								class="pay-amount-input pos-themed-input"
								:no-data-text="__('Address not found')"
								hide-details
								:customFilter="addressFilter"
								append-icon="mdi-plus"
								@click:append="new_address"
							>
								<template v-slot:item="{ props, item }">
									<v-list-item v-bind="props">
										<v-list-item-title class="text-primary text-subtitle-1">
											<div v-html="(item?.raw && item.raw.address_title) || item.address_title"></div>
										</v-list-item-title>
										<v-list-item-subtitle>
											<div v-html="(item?.raw && item.raw.address_line1) || item.address_line1"></div>
										</v-list-item-subtitle>
										<v-list-item-subtitle v-if="(item?.raw && item.raw.address_line2) || item.address_line2">
											<div v-html="(item?.raw && item.raw.address_line2) || item.address_line2"></div>
										</v-list-item-subtitle>
										<v-list-item-subtitle v-if="(item?.raw && item.raw.city) || item.city">
											<div v-html="(item?.raw && item.raw.city) || item.city"></div>
										</v-list-item-subtitle>
										<v-list-item-subtitle v-if="(item?.raw && item.raw.state) || item.state">
											<div v-html="(item?.raw && item.raw.state) || item.state"></div>
										</v-list-item-subtitle>
										<v-list-item-subtitle v-if="(item?.raw && item.raw.country) || item.country">
											<div v-html="(item?.raw && item.raw.country) || item.country"></div>
										</v-list-item-subtitle>
										<v-list-item-subtitle v-if="(item?.raw && item.raw.mobile_no) || item.mobile_no">
											<div v-html="(item?.raw && item.raw.mobile_no) || item.mobile_no"></div>
										</v-list-item-subtitle>
										<v-list-item-subtitle v-if="(item?.raw && item.raw.address_type) || item.address_type">
											<div v-html="(item?.raw && item.raw.address_type) || item.address_type"></div>
										</v-list-item-subtitle>
									</v-list-item>
								</template>
							</v-autocomplete>
						</v-col>
					</v-row>

					<!-- Additional Notes -->
					<v-row dense v-if="pos_profile.posa_display_additional_notes">
						<v-col cols="12">
							<v-textarea
								class="pay-amount-input"
								variant="outlined"
								density="compact"
								clearable
								color="primary"
								auto-grow
								rows="2"
								:label="frappe._('Additional Notes')"
								v-model="invoice_doc.posa_notes"
								hide-details
							></v-textarea>
						</v-col>
					</v-row>

					<!-- Authorization Code -->
					<v-row dense v-if="pos_profile.posa_display_authorization_code">
						<v-col cols="12" md="6">
							<v-text-field
								class="pay-amount-input pos-themed-input"
								variant="outlined"
								density="compact"
								clearable
								color="primary"
								:label="frappe._('Authorization Code')"
								v-model="invoice_doc.posa_authorization_code"
								hide-details
								autocomplete="off"
								maxlength="32"
							></v-text-field>
						</v-col>
					</v-row>

					<!-- Customer Purchase Order -->
					<template v-if="pos_profile.posa_allow_customer_purchase_order">
						<v-row dense class="mt-1">
							<v-col cols="6">
								<v-text-field
									v-model="invoice_doc.po_no"
									:label="frappe._('Purchase Order')"
									variant="outlined"
									density="compact"
									class="pay-amount-input pos-themed-input"
									clearable
									color="primary"
									hide-details
								></v-text-field>
							</v-col>
							<v-col cols="6">
								<VueDatePicker
									v-model="new_po_date"
									model-type="format"
									format="dd-MM-yyyy"
									:min-date="new Date()"
									auto-apply
									class="pay-amount-input pos-themed-input"
									@update:model-value="update_po_date()"
								/>
								<v-text-field
									v-model="invoice_doc.po_date"
									:label="frappe._('Purchase Order Date')"
									readonly
									variant="outlined"
									density="compact"
									hide-details
									color="primary"
									class="mt-1"
								></v-text-field>
							</v-col>
						</v-row>
					</template>

					<!-- Switches: Write Off, Cashback, Credit Sale -->
					<div class="pay-switches-row">


						<v-switch
							v-if="invoice_doc && invoice_doc.is_return && pos_profile.use_cashback"
							v-model="is_cashback"
							flat
							density="compact"
							:label="frappe._('Cashback?')"
							class="pay-switch"
							hide-details
						></v-switch>

						<v-switch
							v-if="invoice_doc && invoice_doc.is_return"
							v-model="is_credit_return"
							flat
							density="compact"
							:label="frappe._('Credit Return?')"
							class="pay-switch"
							hide-details
						></v-switch>
					</div>

					<!-- Credit Sale Options -->
					<div v-if="isAutoCreditSale && !invoice_doc.is_return" class="pay-credit-options">
						<VueDatePicker
							v-model="new_credit_due_date"
							model-type="format"
							format="dd-MM-yyyy"
							:min-date="new Date()"
							auto-apply
							class="pay-amount-input pos-themed-input"
							@update:model-value="update_credit_due_date()"
						/>
						<v-text-field
							class="mt-2 pay-amount-input"
							density="compact"
							variant="outlined"
							type="number"
							min="0"
							max="365"
							v-model.number="credit_due_days"
							:label="frappe._('Days until due')"
							hide-details
							@change="applyDuePreset(credit_due_days)"
						></v-text-field>
						<div class="mt-2 d-flex flex-wrap gap-1">
							<v-chip
								v-for="d in credit_due_presets"
								:key="d"
								size="small"
								variant="outlined"
								color="primary"
								class="pay-denom-chip"
								@click="applyDuePreset(d)"
							>
								{{ d }} {{ frappe._("days") }}
							</v-chip>
						</div>
					</div>



					<!-- Sales Person & Print Format -->
					<v-row dense class="mt-2">
						<v-col cols="12">
							<p v-if="sales_persons && sales_persons.length > 0" class="pay-helper-text">
								{{ sales_persons.length }} {{ __("sales persons found") }}
							</p>
							<p v-else class="pay-helper-text pay-helper-error">{{ __("No sales persons found") }}</p>
							<v-select
								density="compact"
								clearable
								variant="outlined"
								color="primary"
								:label="frappe._('Sales Person')"
								v-model="sales_person"
								:items="sales_persons"
								item-title="title"
								item-value="value"
								class="pay-amount-input pos-themed-input"
								:no-data-text="__('Sales Person not found')"
								hide-details
								:disabled="readonly"
							></v-select>
						</v-col>
					</v-row>
					<v-row dense class="mt-1">
						<v-col cols="12">
							<v-select
								density="compact"
								clearable
								variant="outlined"
								color="primary"
								:label="frappe._('Print Format')"
								v-model="print_format"
								:items="print_formats"
								class="pay-amount-input pos-themed-input"
								:no-data-text="__('No Print Formats Found')"
								hide-details
							></v-select>
						</v-col>
					</v-row>
				</div>
			</div>
		</div>

		<!-- ═══════════════════════════════════════════ -->
		<!-- ACTION BUTTONS                             -->
		<!-- ═══════════════════════════════════════════ -->
		<div class="pay-actions">
			<v-row no-gutters class="pay-actions-row">
				<v-col cols="6" class="pr-1">
					<v-btn
						ref="submitButton"
						block
						size="x-large"
						color="primary"
						variant="flat"
						rounded="lg"
						class="pay-action-btn pay-submit-btn"
						@click="submit"
						:loading="loading"
						:disabled="loading || vaildatPayment"
						:class="{ 'pay-submit-highlight': highlightSubmit }"
					>
						<v-icon start size="20">mdi-check</v-icon>
						{{ __("Submit") }}
					</v-btn>
				</v-col>
				<v-col cols="6" class="pl-1">
					<v-btn
						block
						size="x-large"
						color="success"
						variant="flat"
						rounded="lg"
						class="pay-action-btn"
						@click="submit(undefined, false, true)"
						:loading="loading"
						:disabled="loading || vaildatPayment"
					>
						<v-icon start size="20">mdi-printer-check</v-icon>
						{{ __("Submit & Print") }}
					</v-btn>
				</v-col>
			</v-row>
			<v-btn
				block
				size="large"
				variant="outlined"
				rounded="lg"
				class="pay-cancel-btn mt-2"
				@click="back_to_invoice"
			>
				<v-icon start size="18">mdi-arrow-left</v-icon>
				{{ __("Cancel Payment") }}
			</v-btn>
		</div>

		<!-- Custom Days Dialog -->
		<v-dialog v-model="custom_days_dialog" max-width="340px">
			<v-card rounded="xl" class="pos-themed-card pa-2">
				<v-card-title class="text-h6 pb-0">
					{{ __("Custom Due Days") }}
				</v-card-title>
				<v-card-text>
					<v-text-field
						density="compact"
						variant="outlined"
						type="number"
						min="0"
						max="365"
						class="pay-amount-input pos-themed-input mt-2"
						v-model.number="custom_days_value"
						:label="frappe._('Days')"
						hide-details
					></v-text-field>
				</v-card-text>
				<v-card-actions class="px-4 pb-3">
					<v-spacer></v-spacer>
					<v-btn variant="text" @click="custom_days_dialog = false">
						{{ __("Close") }}
					</v-btn>
					<v-btn color="primary" variant="flat" rounded="lg" @click="applyCustomDays">
						{{ __("Apply") }}
					</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<!-- Phone Payment Dialog -->
		<v-dialog v-model="phone_dialog" max-width="420px">
			<v-card rounded="xl" class="pos-themed-card pa-2">
				<v-card-title class="pb-0">
					<span class="text-h6">{{ __("Confirm Mobile Number") }}</span>
				</v-card-title>
				<v-card-text>
					<v-text-field
						density="compact"
						variant="outlined"
						color="primary"
						:label="frappe._('Mobile Number')"
						class="pay-amount-input pos-themed-input mt-2"
						hide-details
						v-model="invoice_doc.contact_mobile"
						type="number"
					></v-text-field>
				</v-card-text>
				<v-card-actions class="px-4 pb-3">
					<v-spacer></v-spacer>
					<v-btn variant="text" @click="phone_dialog = false">
						{{ __("Close") }}
					</v-btn>
					<v-btn color="primary" variant="flat" rounded="lg" @click="request_payment">
						{{ __("Request") }}
					</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</div>
</template>

<script>
/* global frappe, __, get_currency_symbol */
// Importing format mixin for currency and utility functions
import format, { formatUtils } from "../../format";
import { getSmartTenderSuggestions } from "../../../utils/smartTender.js";
import {
	saveOfflineInvoice,
	syncOfflineInvoices,
	getPendingOfflineInvoiceCount,
	isOffline,
	getSalesPersonsStorage,
	setSalesPersonsStorage,
	updateLocalStock,
} from "../../../offline/index.js";

import renderOfflineInvoiceHTML from "../../../offline_print_template";
import {
	appendDebugPrintParam,
	isDebugPrintEnabled,
	silentPrint,
	watchPrintWindow,
} from "../../plugins/print.js";
import { useInvoiceStore } from "../../stores/invoiceStore.js";
import { useCustomersStore } from "../../stores/customersStore.js";
import { storeToRefs } from "pinia";
import stockCoordinator from "../../utils/stockCoordinator.js";
import { parseBooleanSetting } from "../../utils/stock.js";

export default {
	// Using format mixin for shared formatting methods
	mixins: [format],
	setup() {
		const invoiceStore = useInvoiceStore();
		const customersStore = useCustomersStore();
		const { selectedCustomer, customerInfo } = storeToRefs(customersStore);
		return { invoiceStore, selectedCustomer, customerInfoFromStore: customerInfo };
	},
	data() {
		return {
			loading: false, // UI loading state
			pos_profile: "", // POS profile settings
			pos_settings: {}, // POS settings
			stock_settings: "", // Stock settings
			invoiceType: "Invoice", // Type of invoice
			is_return: false, // Is this a return invoice?
			loyalty_amount: 0, // Loyalty points to redeem
			redeemed_customer_credit: 0, // Customer credit to redeem
			credit_change: 0, // Change to be given as credit
			paid_change: 0, // Change to be given as paid
			// is_credit_sale is now a computed property (isAutoCreditSale)
			is_write_off_change: false, // Write-off for change enabled
			is_cashback: true, // Cashback enabled
			is_credit_return: false, // Is this a credit return?
			redeem_customer_credit: false, // Redeem customer credit?
			customer_credit_dict: [], // List of available customer credits
			paid_change_rules: [], // Validation rules for paid change
			phone_dialog: false, // Show phone payment dialog
			custom_days_dialog: false, // Show custom days dialog
			custom_days_value: null, // Custom days entry
			new_delivery_date: null, // New delivery date value
			new_po_date: null, // New PO date value
			new_credit_due_date: null, // New credit due date value
			credit_due_days: null, // Number of days until due
			credit_due_presets: [7, 14, 30], // Preset options for due days
			return_valid_upto_date: null, // Return valid until display date
			customer_info: "", // Customer info
			mpesa_modes: [], // List of available M-Pesa modes
			sales_persons: [], // List of sales persons
			sales_person: "", // Selected sales person
			print_formats: [], // List of print formats
			print_format: "", // Selected print format
			addresses: [], // List of customer addresses
			is_user_editing_paid_change: false, // User interaction flag
			highlightSubmit: false, // Highlight state for submit button
			last_payment_change_was_cash: null, // Track last edited payment type
			backgroundStatusCheck: null,
			paymentVisible: false,
			_shortcutHandlers: {},
		};
	},
	computed: {
		invoice_doc: {
			get() {
				return this.invoiceStore.invoiceDoc;
			},
			set(value) {
				this.invoiceStore.setInvoiceDoc(value);
			},
		},
		// Get currency symbol for given or current currency
		currencySymbol() {
			return (currency) => {
				const fallbackCurrency = this.invoice_doc ? this.invoice_doc.currency : undefined;
				return get_currency_symbol(currency || fallbackCurrency);
			};
		},
		// Display currency for invoice
		displayCurrency() {
			return this.invoice_doc ? this.invoice_doc.currency : "";
		},
		blockSaleBeyondAvailableQty() {
			if (["Order", "Quotation"].includes(this.invoiceType)) {
				return false;
			}
			return parseBooleanSetting(this.pos_profile?.posa_block_sale_beyond_available_qty);
		},
		// Performance: normalize payment amounts once per reactive update to avoid repeated parsing
		// across totals, change calculations, and denomination rendering (cuts ~3 O(n) scans per render).
		paymentAmountSummary() {
			const payments = Array.isArray(this.invoice_doc?.payments) ? this.invoice_doc.payments : [];
			let total = 0;
			const amountByPayment = new Map();

			payments.forEach((payment) => {
				const amount = parseFloat(formatUtils.fromArabicNumerals(String(payment?.amount))) || 0;
				amountByPayment.set(payment, amount);
				total += amount;
			});

			return {
				payments,
				amountByPayment,
				total: this.flt(total, this.currency_precision),
			};
		},
		// Calculate total payments (all methods, loyalty, credit)
		total_payments() {
			let total = this.paymentAmountSummary.total;

			// Add loyalty amount (convert if needed)
			const doc = this.invoice_doc;

			if (this.loyalty_amount && doc) {
				// Loyalty points are stored in base currency (PKR)
				if (doc.currency && doc.currency !== this.pos_profile.currency) {
					// Convert to selected currency (e.g. USD) by dividing
					total += this.flt(
						this.loyalty_amount / (doc.conversion_rate || 1),
						this.currency_precision,
					);
				} else {
					total += parseFloat(formatUtils.fromArabicNumerals(String(this.loyalty_amount))) || 0;
				}
			}

			// Add redeemed customer credit (convert if needed)
			if (this.redeemed_customer_credit && doc) {
				// Customer credit is stored in base currency (PKR)
				if (doc.currency && doc.currency !== this.pos_profile.currency) {
					// Convert to selected currency (e.g. USD) by dividing
					total += this.flt(
						this.redeemed_customer_credit / (doc.conversion_rate || 1),
						this.currency_precision,
					);
				} else {
					total +=
						parseFloat(formatUtils.fromArabicNumerals(String(this.redeemed_customer_credit))) ||
						0;
				}
			}

			return this.flt(total, this.currency_precision);
		},

		// Calculate difference between invoice total and payments
		diff_payment() {
			if (!this.invoice_doc) return 0;

			// For multi-currency, use grand_total instead of rounded_total
			let invoice_total;
			if (
				this.pos_profile.posa_allow_multi_currency &&
				this.invoice_doc.currency !== this.pos_profile.currency
			) {
				invoice_total = this.flt(this.invoice_doc.grand_total, this.currency_precision);
			} else {
				invoice_total = this.flt(
					this.invoice_doc.rounded_total || this.invoice_doc.grand_total,
					this.currency_precision,
				);
			}

			// Calculate difference (all amounts are in selected currency)
			let diff = this.flt(invoice_total - this.total_payments, this.currency_precision);

			// For returns, ensure difference is not negative
			if (this.invoice_doc.is_return) {
				return diff >= 0 ? diff : 0;
			}

			return diff;
		},

		// Calculate change to be given back to customer
		change_due() {
			if (!this.invoice_doc) {
				return 0;
			}

			// For multi-currency, use grand_total instead of rounded_total
			let invoice_total;
			if (
				this.pos_profile.posa_allow_multi_currency &&
				this.invoice_doc.currency !== this.pos_profile.currency
			) {
				invoice_total = this.flt(this.invoice_doc.grand_total, this.currency_precision);
			} else {
				invoice_total = this.flt(
					this.invoice_doc.rounded_total || this.invoice_doc.grand_total,
					this.currency_precision,
				);
			}

			// Calculate change (all amounts are in selected currency)
			let change = this.flt(this.total_payments - invoice_total, this.currency_precision);

			// Ensure change is not negative
			return change > 0 ? change : 0;
		},

		shouldAutoApplyCreditChange() {
			if (!this.invoice_doc || this.invoice_doc.is_return) {
				return false;
			}

			if (this.change_due <= 0) {
				return false;
			}

			const { payments, amountByPayment } = this.paymentAmountSummary;
			const totals = payments.reduce(
				(accumulator, payment) => {
					if (!payment) {
						return accumulator;
					}

					const amount = this.flt(amountByPayment.get(payment) || 0, this.currency_precision);

					if (this.isCashLikePayment(payment)) {
						accumulator.cash += amount;
					} else {
						accumulator.nonCash += amount;
					}

					return accumulator;
				},
				{ cash: 0, nonCash: 0 },
			);

			return totals.nonCash > 0 && totals.cash === 0;
		},

		// Label for the difference field (To Be Paid/Change)
		diff_label() {
			return this.diff_payment > 0
				? `To Be Paid (${this.displayCurrency})`
				: `Change (${this.displayCurrency})`;
		},
		// Auto-detect credit sale based on payment amount
		// Credit sale = no payment entered (total_payments === 0)
		// Partly paid = some payment but less than invoice total
		// Fully paid = payment equals or exceeds invoice total
		isAutoCreditSale() {
			if (!this.invoice_doc) return false;
			// Auto credit sale when no payments made
			return this.total_payments === 0;
		},
		// Check if payment is partial (some amount paid but not full)
		isPartlyPaid() {
			if (!this.invoice_doc) return false;
			const invoiceTotal = this.flt(
				this.invoice_doc.rounded_total || this.invoice_doc.grand_total,
				this.currency_precision,
			);
			return this.total_payments > 0 && this.total_payments < invoiceTotal;
		},
		// Display formatted total payments
		total_payments_display() {
			return this.formatCurrency(this.total_payments, this.displayCurrency);
		},
		// Display formatted difference payment
		diff_payment_display() {
			const value = this.diff_payment < 0 ? -this.diff_payment : this.diff_payment;
			return this.formatCurrency(value, this.displayCurrency);
		},
		// Calculate available loyalty points amount in selected currency
		available_points_amount() {
			let amount = 0;
			const doc = this.invoice_doc;

			if (this.customer_info.loyalty_points && doc) {
				// Convert loyalty points to amount in base currency (PKR)
				amount = this.customer_info.loyalty_points * this.customer_info.conversion_factor;

				// Convert to selected currency if needed
				if (doc.currency !== this.pos_profile.currency) {
					// Convert PKR to USD by dividing
					amount = this.flt(amount / (doc.conversion_rate || 1), this.currency_precision);
				}
			}
			return amount;
		},
		// Calculate total available customer credit
		available_customer_credit() {
			return this.customer_credit_dict.reduce((total, row) => total + this.flt(row.total_credit), 0);
		},
		// Validate if payment can be submitted
		vaildatPayment() {
			if (!this.pos_profile.posa_allow_sales_order) {
				return false;
			}

			if (this.invoiceType !== "Order") {
				return false;
			}

			const doc = this.invoice_doc;
			return !doc || !doc.posa_delivery_date;
		},
		// Should request payment field be shown?
		request_payment_field() {
			return (
				this.pos_settings?.invoice_fields?.some(
					(el) => el.fieldtype === "Button" && el.fieldname === "request_for_payment",
				) || false
			);
		},
		returnValidityEnabled() {
			return Boolean(
				this.pos_profile?.posa_enable_return_validity ||
					this.pos_settings?.posa_enable_return_validity,
			);
		},
		returnValidityMinDate() {
			const postingDate = this.invoice_doc?.posting_date || frappe.datetime?.nowdate?.();
			if (!postingDate) {
				return new Date();
			}
			const parsed = new Date(postingDate);
			if (Number.isNaN(parsed.getTime())) {
				return new Date();
			}
			return parsed;
		},
	},
	watch: {
		// Watch diff_payment to update paid_change
		diff_payment(newVal) {
			if (this.is_user_editing_paid_change) {
				return;
			}

			const lastEditWasCash = this.last_payment_change_was_cash;

			if (newVal < 0) {
				const changeDue = -newVal;

				if (this.shouldAutoApplyCreditChange || lastEditWasCash === false) {
					this.paid_change = this.flt(changeDue, this.currency_precision);
					this.credit_change = 0;
				} else {
					this.paid_change = changeDue;
				}
			} else {
				this.updateCreditChange(0);
			}

			this.last_payment_change_was_cash = null;
		},
		// Watch paid_change to validate and update credit_change
		paid_change(newVal) {
			const changeLimit = Math.max(-this.diff_payment, 0);
			if (newVal > changeLimit) {
				this.paid_change = changeLimit;
				this.credit_change = 0;
				this.paid_change_rules = ["Paid change can not be greater than total change!"];
			} else {
				this.paid_change_rules = [];
				this.credit_change = this.flt(newVal - changeLimit, this.currency_precision);
			}

			const effectivePaid = Math.min(this.paid_change, changeLimit);
			const creditAmount = this.flt(changeLimit - effectivePaid, this.currency_precision);

			if (this.invoice_doc) {
				this.invoice_doc.paid_change = effectivePaid;
				this.invoice_doc.credit_change = creditAmount > 0 ? creditAmount : 0;
			}
		},
		// Watch loyalty_amount to handle loyalty points redemption
		loyalty_amount(value) {
			if (!this.invoice_doc) {
				return;
			}
			const amount = parseFloat(value) || 0;
			// Use epsilon to handle floating point comparison issues
			if (amount > this.available_points_amount + 0.001) {
				this.invoice_doc.loyalty_amount = 0;
				this.invoice_doc.redeem_loyalty_points = 0;
				this.invoice_doc.loyalty_points = 0;
				this.loyalty_amount = 0;
				this.eventBus.emit("show_message", {
					title: `Loyalty Amount can not be more than ${this.available_points_amount}`,
					color: "error",
				});
			} else {
				this.invoice_doc.loyalty_amount = this.flt(this.loyalty_amount);
				this.invoice_doc.redeem_loyalty_points = 1;

				// Calculate points to redeem, handling currency conversion if needed
				let baseAmount = amount;
				const docCurrency = this.invoice_doc.currency;
				const baseCurrency = this.pos_profile.currency;

				if (docCurrency && baseCurrency && docCurrency !== baseCurrency) {
					baseAmount = amount * (this.invoice_doc.conversion_rate || 1);
				}

				this.invoice_doc.loyalty_points = parseInt(
					baseAmount / (this.customer_info.conversion_factor || 1),
				);

				if (!this.isAutoCreditSale && this.invoice_doc.payments) {
					const default_payment = this.invoice_doc.payments.find((p) => p.default === 1);
					if (default_payment) {
						const invoice_total = this.invoice_doc.rounded_total || this.invoice_doc.grand_total;
						const other_payments = this.invoice_doc.payments.reduce((sum, p) => {
							if (p !== default_payment) {
								return sum + this.flt(p.amount);
							}
							return sum;
						}, 0);
						const loyalty = this.flt(this.invoice_doc.loyalty_amount);
						const credit = this.flt(this.redeemed_customer_credit);

						let new_amount = invoice_total - loyalty - credit - other_payments;
						if (new_amount < 0) new_amount = 0;

						default_payment.amount = this.flt(new_amount, this.currency_precision);
					}
				}
			}
		},
		// Watch redeemed_customer_credit to validate
		redeemed_customer_credit(newVal) {
			if (newVal > this.available_customer_credit) {
				this.redeemed_customer_credit = this.available_customer_credit;
				this.eventBus.emit("show_message", {
					title: `You can redeem customer credit up to ${this.available_customer_credit}`,
					color: "error",
				});
			}
		},
		// Recalculate total redeemed credit whenever credit entries change
		customer_credit_dict: {
			handler(newVal) {
				const total = newVal.reduce((sum, row) => sum + this.flt(row.credit_to_redeem || 0), 0);
				this.redeemed_customer_credit = this.flt(total, this.currency_precision);
			},
			deep: true,
		},
		// Watch sales_person to update sales_team
		sales_person(newVal) {
			if (!this.invoice_doc) {
				return;
			}
			if (newVal) {
				this.invoice_doc.sales_team = [
					{
						sales_person: newVal,
						allocated_percentage: 100,
					},
				];
				console.log("Updated sales_team with sales_person:", newVal);
			} else {
				this.invoice_doc.sales_team = [];
				console.log("Cleared sales_team");
			}
		},
		// is_credit_sale watcher removed - now auto-detected via isAutoCreditSale computed property
		// Watch is_credit_return to toggle cashback payments
		is_credit_return(newVal) {
			if (!this.invoice_doc) {
				return;
			}
			if (newVal) {
				this.is_cashback = false;
				// Clear any payment amounts
				this.invoice_doc.payments.forEach((payment) => {
					payment.amount = 0;
					if (payment.base_amount !== undefined) {
						payment.base_amount = 0;
					}
				});
			} else {
				this.is_cashback = true;
				// Ensure default negative payment for returns
				this.ensureReturnPaymentsAreNegative();
			}
		},
		"invoice_doc.customer"(customer, previous) {
			if (customer && customer !== previous) {
				this.get_addresses();
				this.set_print_format();
			} else if (!customer) {
				this.addresses = [];
				this.print_format = "";
			}
		},
		"invoice_doc.posa_delivery_date"(date) {
			if (!date) {
				if (this.invoice_doc) {
					this.invoice_doc.shipping_address_name = null;
				}
				this.addresses = [];
				return;
			}
			if (this.invoice_doc && this.invoice_doc.customer) {
				this.get_addresses();
			}
		},
		customerInfoFromStore(newInfo) {
			this.customer_info = newInfo || "";
		},
		selectedCustomer(newCustomer, oldCustomer) {
			if (newCustomer === oldCustomer) {
				return;
			}
			this.customer_credit_dict = [];
			this.redeem_customer_credit = false;
			this.is_cashback = true;
			this.is_credit_return = false;
		},
	},
	methods: {
		extractSubmissionErrorMessage(exc) {
			if (!exc) {
				return __("Unknown error");
			}
			if (exc?._server_messages) {
				try {
					const parsed = JSON.parse(exc._server_messages);
					if (Array.isArray(parsed) && parsed.length) {
						const first = parsed[0];
						// Check if message is a JSON string containing errors (stock validation)
						try {
							const msgObj = JSON.parse(first);
							if (msgObj.errors && Array.isArray(msgObj.errors)) {
								return this.formatStockErrors(msgObj.errors);
							}
							// Handle {message: "..."} format
							if (msgObj.message) {
								return frappe.utils.strip_html(msgObj.message);
							}
						} catch {
							/* Not a JSON string */
						}

						if (typeof first === "string") {
							return frappe.utils.strip_html(first);
						}
					}
				} catch {
					/* ignore parse issues */
				}
			}
			if (exc?.message && typeof exc.message === "string") {
				try {
					const parsed = JSON.parse(exc.message);
					if (parsed.errors && Array.isArray(parsed.errors)) {
						return this.formatStockErrors(parsed.errors);
					}
				} catch {
					/* Not a JSON string */
				}
				return exc.message;
			}
			// Handle plain objects with exc or exception fields
			if (exc?.exc) {
				return typeof exc.exc === "string" ? exc.exc : JSON.stringify(exc.exc);
			}
			if (exc?.exception) {
				return typeof exc.exception === "string" ? exc.exception : JSON.stringify(exc.exception);
			}
			// Fallback: try JSON.stringify for objects
			if (typeof exc === "object") {
				try {
					const str = JSON.stringify(exc);
					return str.length > 200 ? str.substring(0, 200) + "..." : str;
				} catch {
					return __("Unknown error");
				}
			}
			return exc.toString ? exc.toString() : __("Unknown error");
		},
		formatStockErrors(errors) {
			const msg = errors
				.map((e) => `${e.item_code} (${e.warehouse}) - ${this.formatFloat(e.available_qty)}`)
				.join("\n");
			const blocking = !this.stock_settings.allow_negative_stock || this.blockSaleBeyondAvailableQty;

			return blocking
				? __("Insufficient stock:\n{0}", [msg])
				: __("Stock is lower than requested:\n{0}", [msg]);
		},
		// Go back to invoice view and reset customer readonly
		back_to_invoice() {
			this.eventBus.emit("show_payment", "false");
			this.eventBus.emit("set_customer_readonly", false);
			this.$nextTick(() => {
				this.eventBus.emit("focus_item_search");
			});
		},
		finishSubmissionNavigation(clearInvoice = false) {
			this.back_to_invoice();
			if (clearInvoice) {
				this.addresses = [];
				this.eventBus.emit("clear_invoice");
				this.eventBus.emit("reset_posting_date");
			}
		},
		// Highlight and focus the submit button when payment screen opens
		handleShowPayment(data) {
			if (data === "true") {
				this.paymentVisible = true;
				this.$nextTick(() => {
					setTimeout(() => {
						const btn = this.$refs.submitButton;
						const el = btn && btn.$el ? btn.$el : btn;
						if (el) {
							el.scrollIntoView({ behavior: "smooth", block: "center" });
							el.focus();
							this.highlightSubmit = true;
						}
					}, 100);
				});
			} else {
				this.paymentVisible = false;
				this.highlightSubmit = false;
			}
		},
		// Reset all cash payments to zero
		reset_cash_payments() {
			this.invoice_doc.payments.forEach((payment) => {
				if (payment.mode_of_payment.toLowerCase() === "cash") {
					payment.amount = 0;
				}
			});
		},
		// Ensure all payments are negative for return invoices
		ensureReturnPaymentsAreNegative() {
			if (!this.invoice_doc || !this.invoice_doc.is_return || !this.is_cashback) {
				return;
			}
			// Check if any payment amount is set
			let hasPaymentSet = false;
			this.invoice_doc.payments.forEach((payment) => {
				if (Math.abs(payment.amount) > 0) {
					hasPaymentSet = true;
				}
			});
			// If no payment set, set the default one
			if (!hasPaymentSet) {
				const default_payment = this.invoice_doc.payments.find((payment) => payment.default === 1);
				if (default_payment) {
					const amount = this.invoice_doc.rounded_total || this.invoice_doc.grand_total;
					default_payment.amount = -Math.abs(amount);
					if (default_payment.base_amount !== undefined) {
						default_payment.base_amount = -Math.abs(amount);
					}
				}
			}
			// Ensure all set payments are negative
			this.invoice_doc.payments.forEach((payment) => {
				if (payment.amount > 0) {
					payment.amount = -Math.abs(payment.amount);
				}
				if (payment.base_amount !== undefined && payment.base_amount > 0) {
					payment.base_amount = -Math.abs(payment.base_amount);
				}
			});
		},
		// Submit payment after validation
		async submit(event, payment_received = false, print = false) {
			this.loading = true;
			try {
				// For return invoices, ensure payment amounts are negative
				if (this.invoice_doc.is_return) {
					this.ensureReturnPaymentsAreNegative();
				}
				// AUTO CREDIT SALE LOGIC:
				// - If total_payments === 0 → Credit Sale (allowed if posa_allow_credit_sale is enabled)
				// - If 0 < total_payments < invoice_total → Partly Paid (allowed if posa_allow_partial_payment is enabled)
				// - If total_payments >= invoice_total → Fully Paid

				const invoiceTotal = this.invoice_doc.rounded_total || this.invoice_doc.grand_total;

				// Quotation does not require any payment — skip credit/partial validation
				const isQuotation = this.invoiceType === "Quotation";

				// Credit Sale validation - if no payment entered, must have credit sale permission
				if (
					!isQuotation &&
					this.isAutoCreditSale &&
					!this.invoice_doc.is_return &&
					invoiceTotal > 0 &&
					!this.pos_profile.posa_allow_credit_sale
				) {
					this.eventBus.emit("show_message", {
						title: `Credit sale is not allowed. Please enter payment amount.`,
						color: "error",
					});
					frappe.utils.play_sound("error");
					return;
				}

				// Partly Paid validation - if partial payment, must have partial payment permission
				if (
					!isQuotation &&
					this.isPartlyPaid &&
					!this.invoice_doc.is_return &&
					invoiceTotal > 0 &&
					!this.pos_profile.posa_allow_partial_payment
				) {
					this.eventBus.emit("show_message", {
						title: `Partial payment is not allowed. Please pay the full amount.`,
						color: "error",
					});
					frappe.utils.play_sound("error");
					return;
				}
				// Validate phone payment
				let phone_payment_is_valid = true;
				if (!payment_received) {
					this.invoice_doc.payments.forEach((payment) => {
						if (
							payment.type === "Phone" &&
							![0, "0", "", null, undefined].includes(payment.amount)
						) {
							phone_payment_is_valid = false;
						}
					});
					if (!phone_payment_is_valid) {
						this.eventBus.emit("show_message", {
							title: __("Please request phone payment or use another payment method"),
							color: "error",
						});
						frappe.utils.play_sound("error");
						return;
					}
				}
				// Validate paid_change
				const changeLimit = Math.max(-this.diff_payment, 0);
				if (this.paid_change > changeLimit) {
					this.eventBus.emit("show_message", {
						title: `Paid change cannot be greater than total change!`,
						color: "error",
					});
					frappe.utils.play_sound("error");
					return;
				}
				// Validate cashback
				let total_change = this.flt(this.flt(this.paid_change) + this.flt(-this.credit_change));
				if (this.is_cashback && total_change !== changeLimit) {
					this.eventBus.emit("show_message", {
						title: `Error in change calculations!`,
						color: "error",
					});
					frappe.utils.play_sound("error");
					return;
				}
				// Validate customer credit redemption
				let credit_calc_check = this.customer_credit_dict.filter((row) => {
					return this.flt(row.credit_to_redeem) > this.flt(row.total_credit);
				});
				if (credit_calc_check.length > 0) {
					this.eventBus.emit("show_message", {
						title: `Redeemed credit cannot be greater than its total.`,
						color: "error",
					});
					frappe.utils.play_sound("error");
					return;
				}
				if (
					!this.invoice_doc.is_return &&
					this.redeemed_customer_credit >
						(this.invoice_doc.rounded_total || this.invoice_doc.grand_total)
				) {
					this.eventBus.emit("show_message", {
						title: `Cannot redeem customer credit more than invoice total`,
						color: "error",
					});
					frappe.utils.play_sound("error");
					return;
				}
				// Proceed to submit the invoice
				// We rely on backend validation in submit_invoice to catch stock issues
				await this.submit_invoice(print);
			} catch (error) {
				console.error("An error occurred during submission:", error);
				// Optionally, emit a generic error message to the user
				this.eventBus.emit("show_message", {
					title: __("An unexpected error occurred. Please check the console for details."),
					color: "error",
				});
			} finally {
				this.loading = false;
			}
		},

		// Submit invoice to backend after all validations
		async submit_invoice(print) {
			// For return invoices, ensure payments are negative one last time
			if (this.invoice_doc.is_return) {
				this.ensureReturnPaymentsAreNegative();
			}
			let totalPayedAmount = 0;
			this.invoice_doc.payments.forEach((payment) => {
				payment.amount = this.flt(payment.amount);
				totalPayedAmount += payment.amount;
			});
			if (this.invoice_doc.is_return && totalPayedAmount === 0) {
				this.invoice_doc.is_pos = 0;
			}
			if (this.customer_credit_dict.length) {
				this.customer_credit_dict.forEach((row) => {
					row.credit_to_redeem = this.flt(row.credit_to_redeem);
				});
			}
			const changeLimit = !this.invoice_doc.is_return ? Math.max(-this.diff_payment, 0) : 0;
			const paidChange = !this.invoice_doc.is_return
				? this.flt(Math.min(this.paid_change, changeLimit), this.currency_precision)
				: 0;
			const creditChange = !this.invoice_doc.is_return
				? this.flt(Math.max(changeLimit - paidChange, 0), this.currency_precision)
				: 0;

			if (this.invoice_doc) {
				this.invoice_doc.paid_change = paidChange;
				this.invoice_doc.credit_change = creditChange;
			}

			if (!this.invoice_doc.is_return) {
				this.credit_change = creditChange ? -creditChange : 0;
				this.paid_change = paidChange;
			}

			let data = {
				total_change: changeLimit,
				paid_change: paidChange,
				credit_change: creditChange,
				redeemed_customer_credit: this.redeemed_customer_credit,
				customer_credit_dict: this.customer_credit_dict,
				is_cashback: this.is_cashback,
				is_credit_sale: this.isAutoCreditSale, // Auto-detected based on payment amount
				is_partly_paid: this.isPartlyPaid, // Partial payment flag
			};

			if (isOffline()) {
				try {
					// Set is_credit_sale on invoice_doc for offline print template
					this.invoice_doc.is_credit_sale = this.isAutoCreditSale;
					this.invoice_doc.is_partly_paid = this.isPartlyPaid;
					saveOfflineInvoice({ data: data, invoice: this.invoice_doc });
					this.eventBus.emit("pending_invoices_changed", getPendingOfflineInvoiceCount());
					this.eventBus.emit("show_message", {
						title: __("Invoice saved offline"),
						color: "warning",
					});
					if (print) {
						this.print_offline_invoice(this.invoice_doc);
					}
					this.eventBus.emit("clear_invoice");
					this.eventBus.emit("focus_item_search");
					this.eventBus.emit("reset_posting_date");
					this.back_to_invoice();
					return;
				} catch (error) {
					this.eventBus.emit("show_message", {
						title: __("Cannot Save Offline Invoice: ") + (error.message || __("Unknown error")),
						color: "error",
					});
					return;
				}
			}

			try {
				const r = await frappe.call({
					method:
						this.invoiceType === "Order"
							? "posawesome.posawesome.api.sales_orders.submit_sales_order"
							: this.invoiceType === "Quotation"
								? "posawesome.posawesome.api.quotations.submit_quotation"
								: "posawesome.posawesome.api.invoices.submit_invoice",
					args: {
						data: data,
						invoice: this.invoice_doc,
						order: this.invoice_doc,
						submit_in_background: this.pos_profile.posa_allow_submissions_in_background_job,
					},
				});

				if (!r.message) {
					if (
						this.pos_profile?.posa_allow_submissions_in_background_job &&
						this.eventBus &&
						typeof this.eventBus.emit === "function"
					) {
						this.eventBus.emit("invoice_submission_failed", {
							invoice: this.invoice_doc?.name,
							reason: __("No response from server"),
						});
					}
					this.eventBus.emit("show_message", {
						title: __("Error submitting invoice: No response from server"),
						color: "error",
					});
					return;
				}

				const docstatus = r.message?.docstatus;
				const status = r.message?.status;
				const responseInvoiceName = r.message?.name || this.invoice_doc?.name;
				const backgroundReason =
					r.message?.error || r.message?.exc || r.message?.exception || r.message?.message;

				const wasSubmitted =
					docstatus === 1 || status === 1 || (docstatus === undefined && status === undefined);

				if (!wasSubmitted && backgroundReason) {
					if (this.pos_profile?.posa_allow_submissions_in_background_job) {
						if (this.eventBus && typeof this.eventBus.emit === "function") {
							this.eventBus.emit("invoice_submission_failed", {
								invoice: responseInvoiceName,
								reason: backgroundReason,
							});
						}
					}

					this.eventBus.emit("show_message", {
						title: __("Error submitting invoice: {0}", [responseInvoiceName || ""]),
						color: "error",
						detail: backgroundReason,
					});
					this.finishSubmissionNavigation(true);
					this.scheduleBackgroundStatusCheck(responseInvoiceName, r.message?.doctype);
					return;
				}

				// Update invoice_doc with response name so print uses the correct document
				if (r.message?.name) {
					this.invoice_doc.name = r.message.name;
				}
				if (print) {
					this.load_print_page();
				}
				this.customer_credit_dict = [];
				this.redeem_customer_credit = false;
				this.is_cashback = true;
				this.is_credit_return = false;
				this.sales_person = "";
				this.eventBus.emit("set_last_invoice", r.message?.name || this.invoice_doc.name);
				this.eventBus.emit("show_message", {
					title:
						this.invoiceType === "Order"
							? __("Sales Order {0} is Submitted", [r.message.name])
							: this.invoiceType === "Quotation"
								? __("Quotation {0} is Submitted", [r.message.name])
								: __("Invoice {0} is Submitted", [r.message.name]),
					color: "success",
				});
				frappe.utils.play_sound("submit");
				const submittedItems = Array.isArray(this.invoice_doc.items) ? this.invoice_doc.items : [];
				updateLocalStock(submittedItems);
				stockCoordinator.applyInvoiceConsumption(submittedItems, {
					source: "invoice",
				});
				const submittedCodes = submittedItems
					.map((item) => (item ? item.item_code : null))
					.filter((code) => code !== undefined && code !== null);
				this.eventBus.emit("invoice_stock_adjusted", {
					items: submittedItems,
					item_codes: submittedCodes,
					timestamp: Date.now(),
				});
				this.finishSubmissionNavigation(true);
				this.scheduleBackgroundStatusCheck(responseInvoiceName, r.message?.doctype);
			} catch (exc) {
				console.error("Error submitting invoice:", exc);
				let errorMsg = this.extractSubmissionErrorMessage(exc);
				if (errorMsg.includes("Amount must be negative")) {
					this.eventBus.emit("show_message", {
						title: __("Fixing payment amounts for return invoice..."),
						color: "warning",
					});
					this.invoice_doc.payments.forEach((payment) => {
						if (payment.amount > 0) {
							payment.amount = -Math.abs(payment.amount);
						}
						if (payment.base_amount > 0) {
							payment.base_amount = -Math.abs(payment.base_amount);
						}
					});
					console.log("Retrying submission with fixed payment amounts");
					setTimeout(() => {
						this.submit_invoice(print);
					}, 500);
				} else {
					if (
						this.pos_profile?.posa_allow_submissions_in_background_job &&
						this.eventBus &&
						typeof this.eventBus.emit === "function"
					) {
						this.eventBus.emit("invoice_submission_failed", {
							invoice: this.invoice_doc?.name,
							reason: errorMsg,
						});
					}
					this.eventBus.emit("show_message", {
						title: __("Error submitting invoice: ") + errorMsg,
						color: "error",
					});
					if (this.pos_profile?.posa_allow_submissions_in_background_job) {
						this.finishSubmissionNavigation(true);
						this.scheduleBackgroundStatusCheck(this.invoice_doc?.name, this.invoice_doc?.doctype);
					}
				}
			}
		},
		scheduleBackgroundStatusCheck(invoiceName, doctype) {
			this.clearBackgroundStatusCheck();
			if (!this.pos_profile?.posa_allow_submissions_in_background_job) {
				return;
			}
			if (!invoiceName) {
				return;
			}
			this.backgroundStatusCheck = setTimeout(async () => {
				try {
					const result = await frappe.call({
						method: "frappe.client.get_value",
						args: {
							doctype: doctype || this.invoice_doc?.doctype || "Sales Invoice",
							filters: { name: invoiceName },
							fieldname: ["docstatus"],
						},
					});
					const status = result?.message?.docstatus;
					if (status === 1) {
						return;
					}
					const reason = this.__("Invoice is still in draft after background submission.");
					if (this.eventBus && typeof this.eventBus.emit === "function") {
						this.eventBus.emit("invoice_submission_failed", {
							invoice: invoiceName,
							reason,
						});
					}
					this.eventBus.emit("show_message", {
						title: __("Error submitting invoice: {0}", [invoiceName]),
						color: "error",
						detail: reason,
					});
				} catch (err) {
					console.error("Background status check failed", err);
				} finally {
					this.clearBackgroundStatusCheck();
				}
			}, 10000);
		},
		clearBackgroundStatusCheck() {
			if (this.backgroundStatusCheck) {
				clearTimeout(this.backgroundStatusCheck);
				this.backgroundStatusCheck = null;
			}
		},
		// Set full amount for a payment method (or negative for returns)
		// Accepts array index (0-based) from v-for template
		set_full_amount(arrayIndex) {
			const payments = this.invoice_doc.payments;
			if (!payments || arrayIndex < 0 || arrayIndex >= payments.length) return;

			const isReturn = this.invoice_doc.is_return || this.invoiceType === "Return";
			const totalAmount = this.invoice_doc.rounded_total || this.invoice_doc.grand_total;
			const amount = isReturn ? -Math.abs(totalAmount) : totalAmount;

			// Reset all payments to 0, then set the target one
			for (let i = 0; i < payments.length; i++) {
				if (i === arrayIndex) {
					payments[i].amount = amount;
					if (payments[i].base_amount !== undefined) {
						payments[i].base_amount = amount;
					}
				} else {
					payments[i].amount = 0;
					if (payments[i].base_amount !== undefined) {
						payments[i].base_amount = 0;
					}
				}
			}
		},
		// Set remaining amount for a payment method when focused
		set_rest_amount(idx) {
			const isReturn = this.invoice_doc.is_return || this.invoiceType === "Return";
			let changed = false;
			this.invoice_doc.payments.forEach((payment) => {
				if (payment.idx === idx && payment.amount === 0 && this.diff_payment > 0) {
					let amount = this.diff_payment;
					if (isReturn) {
						amount = -Math.abs(amount);
					}
					payment.amount = amount;
					if (payment.base_amount !== undefined) {
						payment.base_amount = isReturn ? -Math.abs(amount) : amount;
					}
					changed = true;
				}
			});
			if (changed) {
				this.invoice_doc.payments = [...this.invoice_doc.payments];
			}
		},
		// Clear all payment amounts
		clear_all_amounts() {
			this.invoice_doc.payments.forEach((payment) => {
				payment.amount = 0;
			});
		},
		// Open print page for invoice
		load_print_page() {
			const print_format =
				this.print_format ||
				this.pos_profile.print_format_for_online ||
				this.pos_profile.print_format;
			const letter_head = this.pos_profile.letter_head || 0;
			let doctype;
			const debugPrint = isDebugPrintEnabled();

			if (this.invoiceType === "Quotation") {
				doctype = "Quotation";
			} else if (this.invoiceType === "Order") {
				doctype = "Sales Order";
			} else if (this.pos_profile.create_pos_invoice_instead_of_sales_invoice) {
				doctype = "POS Invoice";
			} else {
				doctype = "Sales Invoice";
			}
			let url =
				frappe.urllib.get_base_url() +
				"/printview?doctype=" +
				encodeURIComponent(doctype) +
				"&name=" +
				this.invoice_doc.name +
				"&trigger_print=1" +
				"&format=" +
				print_format +
				"&no_letterhead=" +
				letter_head;
			url = appendDebugPrintParam(url, debugPrint);
			const printOptions = {
				invoiceDoc: this.invoice_doc,
				allowOfflineFallback: isOffline(),
				triggerPrint: "1",
				debugPrint,
				debugInfo: {
					printFormat: print_format,
					templatePath: "online-printview",
				},
			};

			if (this.pos_profile.posa_open_print_in_new_tab) {
				if (isOffline()) {
					this.open_offline_invoice_preview(this.invoice_doc, {
						debugPrint,
						printFormat: print_format,
					});
					return;
				}
				let newTabUrl =
					frappe.urllib.get_base_url() +
					"/printview?doctype=" +
					encodeURIComponent(doctype) +
					"&name=" +
					this.invoice_doc.name +
					"&trigger_print=0" +
					"&format=" +
					print_format;

				if (this.pos_profile.letter_head) {
					newTabUrl += "&letterhead=" + encodeURIComponent(this.pos_profile.letter_head);
					newTabUrl += "&no_letterhead=0";
				} else {
					newTabUrl += "&no_letterhead=0";
				}

				newTabUrl = appendDebugPrintParam(newTabUrl, debugPrint);
				// Android Share → Print is more reliable, so keep trigger_print=0 and skip auto-print.
				const printWindow = window.open(newTabUrl, "_blank");
				watchPrintWindow(printWindow, {
					...printOptions,
					triggerPrint: "0",
					shouldPrint: false,
				});
				return;
			}

			if (this.pos_profile.posa_silent_print) {
				silentPrint(url, printOptions);
			} else {
				const printWindow = window.open(url, "Print");
				watchPrintWindow(printWindow, printOptions);
			}
		},
		// Print invoice using a more detailed offline template
		async print_offline_invoice(invoice) {
			if (!invoice) return;
			const html = await renderOfflineInvoiceHTML(invoice);
			const win = window.open("", "_blank");
			win.document.write(html);
			win.document.close();
			win.focus();
			win.print();
		},
		// Open offline invoice preview without triggering auto-print (for new-tab mode)
		async open_offline_invoice_preview(invoice, { debugPrint = false, printFormat = "" } = {}) {
			if (!invoice) return;
			const html = await renderOfflineInvoiceHTML(invoice);
			const win = window.open("", "_blank");
			if (!win) return;
			win.document.write(html);
			win.document.close();
			win.focus();
			if (debugPrint) {
				console.log("[POSAwesome][Print Debug]", {
					location: win.location?.href || null,
					online: navigator.onLine,
					trigger_print: "0",
					print_format: printFormat || null,
					template_path: "offline-fallback",
					should_print: false,
				});
			}
		},
		// Validate due date (should not be in the past)
		validate_due_date() {
			const today = frappe.datetime.now_date();
			const new_date = Date.parse(this.invoice_doc.due_date);
			const parse_today = Date.parse(today);
			if (new_date < parse_today) {
				this.invoice_doc.due_date = today;
			}
		},
		// Keyboard shortcuts for payment submit (Alt+X) and submit+print (Alt+P)
		handlePaymentShortcut(event) {
			if (!this.paymentVisible) {
				return;
			}

			const isAltOnly = event.altKey && !event.ctrlKey && !event.metaKey;
			const key = event.key.toLowerCase();

			if (isAltOnly && key === "p") {
				event.preventDefault();
				event.stopPropagation();
				this.submit(null, false, true);
				return;
			}

			if ((isAltOnly || event.ctrlKey || event.metaKey) && key === "x") {
				event.preventDefault();
				event.stopPropagation();
				this.submit(null, false, false);
			}
		},
		handleSubmitPaymentShortcut({ print = false } = {}) {
			if (!this.paymentVisible) {
				return;
			}

			this.$nextTick(() => {
				this.submit(null, false, print);
			});
		},
		// Get available customer credit and auto-allocate
		get_available_credit(use_credit) {
			this.clear_all_amounts();
			if (use_credit) {
				frappe
					.call("posawesome.posawesome.api.payments.get_available_credit", {
						customer: this.invoice_doc.customer,
						company: this.pos_profile.company,
					})
					.then((r) => {
						const data = r.message;
						if (data.length) {
							const amount = this.invoice_doc.rounded_total || this.invoice_doc.grand_total;
							let remainAmount = amount;
							data.forEach((row) => {
								if (remainAmount > 0) {
									if (remainAmount >= row.total_credit) {
										row.credit_to_redeem = row.total_credit;
										remainAmount -= row.total_credit;
									} else {
										row.credit_to_redeem = remainAmount;
										remainAmount = 0;
									}
								} else {
									row.credit_to_redeem = 0;
								}
							});
							this.customer_credit_dict = data;
						} else {
							this.customer_credit_dict = [];
						}
					});
			} else {
				this.customer_credit_dict = [];
			}
		},
		// Get customer addresses for shipping
		get_addresses() {
			const vm = this;
			if (!vm.invoice_doc || !vm.invoice_doc.customer) {
				vm.addresses = [];
				return;
			}
			frappe.call({
				method: "posawesome.posawesome.api.customers.get_customer_addresses",
				args: { customer: vm.invoice_doc.customer },
				async: true,
				callback: function (r) {
					if (!r.exc) {
						const records = Array.isArray(r.message) ? r.message : [];
						const normalized = records.map((row) => vm.normalizeAddress(row)).filter(Boolean);
						vm.addresses = normalized;
						if (
							vm.invoice_doc &&
							vm.invoice_doc.shipping_address_name &&
							!normalized.some((row) => row.name === vm.invoice_doc.shipping_address_name)
						) {
							vm.invoice_doc.shipping_address_name = null;
						}
					} else {
						vm.addresses = [];
					}
				},
			});
		},
		// Filter addresses for autocomplete
		addressFilter(item, queryText) {
			const record = (item && item.raw) || item || {};
			const searchText = (queryText || "").toLowerCase();
			if (!searchText) {
				return true;
			}
			const fields = [
				"address_title",
				"address_line1",
				"address_line2",
				"city",
				"state",
				"country",
				"name",
			];
			return fields.some((field) => {
				const value = record[field];
				if (!value) {
					return false;
				}
				return String(value).toLowerCase().includes(searchText);
			});
		},
		// Open dialog to add new address
		new_address() {
			if (!this.invoice_doc || !this.invoice_doc.customer) {
				this.eventBus.emit("show_message", {
					title: __("Please select a customer first"),
					color: "error",
				});
				return;
			}
			this.eventBus.emit("open_new_address", this.invoice_doc.customer);
		},
		// Get sales person names from API/localStorage
		get_sales_person_names() {
			const vm = this;
			if (vm.pos_profile.posa_local_storage && getSalesPersonsStorage().length) {
				try {
					vm.sales_persons = getSalesPersonsStorage();
				} catch (e) {
					console.error(e);
				}
			}
			frappe.call({
				method: "posawesome.posawesome.api.utilities.get_sales_person_names",
				callback: function (r) {
					if (r.message && r.message.length > 0) {
						vm.sales_persons = r.message.map((sp) => ({
							value: sp.name,
							title: sp.sales_person_name,
							sales_person_name: sp.sales_person_name,
							name: sp.name,
						}));
						if (vm.pos_profile.posa_local_storage) {
							setSalesPersonsStorage(vm.sales_persons);
						}
					} else {
						vm.sales_persons = [];
					}
				},
			});
		},
		// Request payment for phone type
		async request_payment() {
			this.phone_dialog = false;
			if (!this.invoice_doc.contact_mobile) {
				this.eventBus.emit("show_message", {
					title: __("Please set the customer's mobile number"),
					color: "error",
				});
				this.eventBus.emit("open_edit_customer");
				this.back_to_invoice();
				return;
			}

			this.eventBus.emit("freeze", { title: __("Waiting for payment...") });

			try {
				this.invoice_doc.payments.forEach((payment) => {
					payment.amount = this.flt(payment.amount);
				});

				const formData = {
					...this.invoice_doc,
					total_change: !this.invoice_doc.is_return ? Math.max(-this.diff_payment, 0) : 0,
					paid_change: !this.invoice_doc.is_return ? this.paid_change : 0,
					credit_change: -this.credit_change,
					redeemed_customer_credit: this.redeemed_customer_credit,
					customer_credit_dict: this.customer_credit_dict,
					is_cashback: this.is_cashback,
				};

				const updateResponse = await frappe.call({
					method: "posawesome.posawesome.api.invoices.update_invoice",
					args: { data: formData },
				});

				if (updateResponse?.message) {
					this.invoice_doc = updateResponse.message;
				}

				const paymentResponse = await frappe.call({
					method: "posawesome.posawesome.api.payments.create_payment_request",
					args: { doc: this.invoice_doc },
				});

				const payment_request_name = paymentResponse?.message?.name;
				if (!payment_request_name) {
					throw new Error("Payment request failed");
				}

				await new Promise((resolve, reject) => {
					setTimeout(async () => {
						try {
							const { message } = await frappe.db.get_value(
								"Payment Request",
								payment_request_name,
								["status", "grand_total"],
							);

							if (!message) {
								this.eventBus.emit("show_message", {
									title: __(
										"Payment request status could not be retrieved. Please try again",
									),
									color: "error",
								});
								resolve();
								return;
							}

							if (message.status !== "Paid") {
								this.eventBus.emit("show_message", {
									title: __(
										"Payment Request took too long to respond. Please try requesting for payment again",
									),
									color: "error",
								});
								resolve();
								return;
							}

							this.eventBus.emit("show_message", {
								title: __("Payment of {0} received successfully.", [
									this.formatCurrency(message.grand_total, this.invoice_doc.currency, 0),
								]),
								color: "success",
							});

							const doc = await frappe.db.get_doc(
								this.invoice_doc.doctype,
								this.invoice_doc.name,
							);
							this.invoice_doc = doc;
							this.submit(null, true);
							resolve();
						} catch (error) {
							reject(error);
						}
					}, 30000);
				});
			} catch (error) {
				console.error("Payment request error:", error);
				this.eventBus.emit("show_message", {
					title: __(error.message || "Payment request failed"),
					color: "error",
				});
			} finally {
				this.eventBus.emit("unfreeze");
			}
		},
		// Get M-Pesa payment modes from backend
		get_mpesa_modes() {
			const vm = this;
			frappe.call({
				method: "posawesome.posawesome.api.m_pesa.get_mpesa_mode_of_payment",
				args: { company: vm.pos_profile.company },
				async: true,
				callback: function (r) {
					if (!r.exc) {
						vm.mpesa_modes = r.message;
					} else {
						vm.mpesa_modes = [];
					}
				},
			});
		},
		// Check if payment is M-Pesa C2B
		is_mpesa_c2b_payment(payment) {
			if (this.mpesa_modes.includes(payment.mode_of_payment) && payment.type === "Bank") {
				payment.amount = 0;
				return true;
			} else {
				return false;
			}
		},
		// Open M-Pesa payment dialog
		mpesa_c2b_dialog(payment) {
			const data = {
				company: this.pos_profile.company,
				mode_of_payment: payment.mode_of_payment,
				customer: this.invoice_doc.customer,
			};
			this.eventBus.emit("open_mpesa_payments", data);
		},
		// Set M-Pesa payment as customer credit
		set_mpesa_payment(payment) {
			this.pos_profile.use_customer_credit = true;
			this.redeem_customer_credit = true;
			const invoiceAmount = this.invoice_doc.rounded_total || this.invoice_doc.grand_total;
			let amount =
				payment.unallocated_amount > invoiceAmount ? invoiceAmount : payment.unallocated_amount;
			amount = amount > 0 ? amount : 0;
			const advance = {
				type: "Advance",
				credit_origin: payment.name,
				total_credit: this.flt(payment.unallocated_amount),
				credit_to_redeem: this.flt(amount),
			};
			this.clear_all_amounts();
			this.customer_credit_dict.push(advance);
		},
		// Normalize address records returned from the server
		normalizeAddress(address) {
			if (!address) {
				return null;
			}
			const normalized = { ...address };
			const fallback = normalized.address_title || normalized.address_line1 || normalized.name || "";
			normalized.address_title = normalized.address_title || fallback;
			normalized.display_title = fallback;
			return normalized;
		},
		// Update delivery date after selection
		update_delivery_date() {
			const formatted = this.formatDate(this.new_delivery_date);
			if (this.invoice_doc) {
				this.invoice_doc.posa_delivery_date = formatted;
				if (!formatted) {
					this.invoice_doc.shipping_address_name = null;
				}
			} else {
				this.invoiceStore.mergeInvoiceDoc({ posa_delivery_date: formatted });
			}
			if (!formatted) {
				this.addresses = [];
			}
		},
		// Update purchase order date after selection
		update_po_date() {
			this.invoice_doc.po_date = this.formatDate(this.new_po_date);
		},
		// Update credit due date after selection
		update_credit_due_date() {
			this.invoice_doc.due_date = this.formatDate(this.new_credit_due_date);
		},
		// Apply preset or typed number of days to set due date
		applyDuePreset(days) {
			if (days === null || days === "") {
				return;
			}
			const westernDays = formatUtils.fromArabicNumerals(String(days));
			if (isNaN(westernDays)) {
				return;
			}
			const parsed = parseInt(westernDays, 10);
			const d = new Date();
			d.setDate(d.getDate() + parsed);
			this.new_credit_due_date = this.formatDateDisplay(d);
			this.credit_due_days = parsed;
			this.update_credit_due_date();
		},
		// Apply days entered in dialog
		applyCustomDays() {
			this.applyDuePreset(this.custom_days_value);
			this.custom_days_dialog = false;
		},
		calculateReturnValidUntil(baseDate) {
			const formattedBase = this.formatDate(baseDate);
			if (!formattedBase) {
				return null;
			}
			const parsed = new Date(formattedBase);
			if (Number.isNaN(parsed.getTime())) {
				return null;
			}
			const profileDays = parseInt(this.pos_profile?.posa_return_validity_days ?? 0, 10);
			const settingsDays = parseInt(this.pos_settings?.posa_return_validity_days ?? 0, 10);
			const daysSetting = Number.isFinite(profileDays) && profileDays > 0 ? profileDays : settingsDays;
			if (Number.isFinite(daysSetting) && daysSetting > 0) {
				parsed.setDate(parsed.getDate() + daysSetting);
			}
			const year = parsed.getFullYear();
			const month = `0${parsed.getMonth() + 1}`.slice(-2);
			const day = `0${parsed.getDate()}`.slice(-2);
			return `${year}-${month}-${day}`;
		},
		initializeReturnValidity(invoice_doc) {
			if (!this.returnValidityEnabled || !invoice_doc || invoice_doc.is_return) {
				this.return_valid_upto_date = null;
				if (invoice_doc) {
					invoice_doc.posa_return_valid_upto = null;
				}
				return;
			}

			const existing = invoice_doc.posa_return_valid_upto;
			const proposedDate =
				existing ||
				this.calculateReturnValidUntil(invoice_doc.posting_date || frappe.datetime.nowdate());

			if (proposedDate) {
				const backendDate = this.formatDate(proposedDate);
				invoice_doc.posa_return_valid_upto = backendDate;
				this.return_valid_upto_date = this.formatDateDisplay(backendDate);
			}
		},
		updateReturnValidUpto(value) {
			if (!this.returnValidityEnabled) {
				return;
			}
			const formatted = this.formatDate(value);
			this.return_valid_upto_date = this.formatDateDisplay(formatted);
			if (this.invoice_doc) {
				this.invoice_doc.posa_return_valid_upto = formatted;
			} else {
				this.invoiceStore.mergeInvoiceDoc({ posa_return_valid_upto: formatted });
			}
		},
		// Format date to YYYY-MM-DD
		formatDate(date) {
			if (!date) return null;
			if (typeof date === "string") {
				const western = formatUtils.fromArabicNumerals(date);
				if (/^\d{4}-\d{2}-\d{2}$/.test(western)) {
					return western;
				}
				if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(western)) {
					const [d, m, y] = western.split("-");
					return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
				}
				date = western;
			}
			const d = new Date(formatUtils.fromArabicNumerals(String(date)));
			if (!isNaN(d.getTime())) {
				const year = d.getFullYear();
				const month = `0${d.getMonth() + 1}`.slice(-2);
				const day = `0${d.getDate()}`.slice(-2);
				return `${year}-${month}-${day}`;
			}
			return formatUtils.fromArabicNumerals(String(date));
		},

		formatDateDisplay(date) {
			if (!date) return "";
			const western = formatUtils.fromArabicNumerals(String(date));
			if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(western)) {
				const [y, m, d] = western.split("-");
				return formatUtils.toArabicNumerals(`${d}-${m}-${y}`);
			}
			const d = new Date(western);
			if (!isNaN(d.getTime())) {
				const year = d.getFullYear();
				const month = `0${d.getMonth() + 1}`.slice(-2);
				const day = `0${d.getDate()}`.slice(-2);
				return formatUtils.toArabicNumerals(`${day}-${month}-${year}`);
			}
			return formatUtils.toArabicNumerals(western);
		},
		// Show paid amount info message
		showPaidAmount() {
			this.eventBus.emit("show_message", {
				title: `Total Paid Amount: ${this.formatCurrency(this.total_payments)}`,
				color: "info",
			});
		},
		// Format customer credit source label for display
		creditSourceLabel(row) {
			if (!row) {
				return "";
			}
			const sourceLabel = row.source_type ? this.__(row.source_type) : null;
			if (sourceLabel) {
				return `${sourceLabel}: ${row.credit_origin}`;
			}
			return row.credit_origin;
		},
		// Show diff payment info message
		showDiffPayment() {
			if (!this.invoice_doc) return;
			this.eventBus.emit("show_message", {
				title: `To Be Paid: ${this.formatCurrency(
					this.diff_payment < 0 ? -this.diff_payment : this.diff_payment,
				)}`,
				color: "info",
			});
		},
		// Show paid change info message
		showPaidChange() {
			this.eventBus.emit("show_message", {
				title: `Paid Change: ${this.formatCurrency(this.paid_change)}`,
				color: "info",
			});
		},
		// Show credit change info message
		showCreditChange(value) {
			const sanitizedValue = this.flt(value || 0, this.currency_precision);
			if (sanitizedValue > 0) {
				this.updateCreditChange(sanitizedValue);
			} else {
				this.updateCreditChange(0);
			}
		},
		handlePaymentAmountChange(payment, event) {
			this.last_payment_change_was_cash = this.isCashLikePayment(payment);
			format.methods.setFormatedCurrency.call(this, payment, "amount", null, false, event);

			this.$nextTick(() => {
				this.autoBalancePayments(payment);
			});
		},
		setPaymentToDenomination(payment, amount) {
			payment.amount = amount;
			if (payment.base_amount !== undefined) {
				const conversion_rate = this.invoice_doc.conversion_rate || 1;
				payment.base_amount = this.flt(amount * conversion_rate, this.currency_precision);
			}
			this.last_payment_change_was_cash = this.isCashLikePayment(payment);
			this.$nextTick(() => {
				this.autoBalancePayments(payment);
			});
		},
		autoBalancePayments(excludePayment) {
			// Auto-subtract from other payments if we have an excess
			const invoice_total = this.invoice_doc.rounded_total || this.invoice_doc.grand_total;

			// Calculate current total paid
			const current_total_paid = this.paymentAmountSummary.total;

			const excess = this.flt(current_total_paid - invoice_total, this.currency_precision);

			if (excess > 0) {
				// Find other payments with amount > 0 to reduce
				// We filter out the current payment being edited to avoid circular issues
				const otherPayments = this.invoice_doc.payments.filter(
					(p) => p !== excludePayment && this.flt(p.amount) > 0,
				);

				// Sort by amount descending to reduce larger chunks first
				otherPayments.sort((a, b) => this.flt(b.amount) - this.flt(a.amount));

				let remaining_excess = excess;

				for (const other of otherPayments) {
					if (remaining_excess <= 0) break;

					const otherAmount = this.flt(other.amount, this.currency_precision);
					const reduction = Math.min(otherAmount, remaining_excess);
					const newAmount = this.flt(otherAmount - reduction, this.currency_precision);

					other.amount = newAmount;
					if (other.base_amount !== undefined) {
						// Approximate base amount update, though submit logic recalculates it
						other.base_amount = this.flt(
							newAmount / (this.exchange_rate || 1),
							this.currency_precision,
						);
					}

					remaining_excess = this.flt(remaining_excess - reduction, this.currency_precision);
				}
			}
		},
		getVisibleDenominations(payment) {
			if (!this.invoice_doc || !payment) return [];
			const currency = this.invoice_doc.currency;

			const current_total_paid = this.total_payments;
			const { amountByPayment } = this.paymentAmountSummary;
			const current_payment_amount = amountByPayment.get(payment) || 0;

			const other_payments = current_total_paid - current_payment_amount;

			const invoice_total = this.flt(
				this.invoice_doc.rounded_total || this.invoice_doc.grand_total,
				this.currency_precision,
			);

			const amount_to_pay = invoice_total - other_payments;

			if (amount_to_pay <= 0) return [];

			return getSmartTenderSuggestions(amount_to_pay, currency);
		},
		isCashLikePayment(payment) {
			if (!payment) {
				return false;
			}

			const configuredCashMOP = String(this.pos_profile?.posa_cash_mode_of_payment || "").toLowerCase();

			const type = String(payment.type || "").toLowerCase();
			if (type === "cash") {
				return true;
			}

			const mode = String(payment.mode_of_payment || "").toLowerCase();
			if (configuredCashMOP && mode === configuredCashMOP) {
				return true;
			}

			return mode.includes("cash");
		},
		updateCreditChange(rawValue) {
			const changeLimit = Math.max(-this.diff_payment, 0);
			let requestedCredit = this.flt(Math.abs(rawValue) || 0, this.currency_precision);

			if (requestedCredit > changeLimit) {
				requestedCredit = changeLimit;
			}

			const remainingPaidChange = this.flt(changeLimit - requestedCredit, this.currency_precision);

			this.credit_change = requestedCredit ? -requestedCredit : 0;
			this.paid_change = remainingPaidChange;

			if (this.invoice_doc) {
				this.invoice_doc.credit_change = requestedCredit;
				this.invoice_doc.paid_change = remainingPaidChange;
			}
		},
		// Format currency value
		formatCurrency(value) {
			return this.$options.mixins[0].methods.formatCurrency.call(this, value, this.currency_precision);
		},
		// Get change amount for display
		get_change_amount() {
			return Math.max(0, this.total_payments - this.invoice_doc.grand_total);
		},
		// Sync any invoices stored offline and show pending/synced counts
		async syncPendingInvoices() {
			const pending = getPendingOfflineInvoiceCount();
			if (pending) {
				this.eventBus.emit("show_message", {
					title: `${pending} invoice${pending > 1 ? "s" : ""} pending for sync`,
					color: "warning",
				});
				this.eventBus.emit("pending_invoices_changed", pending);
			}
			if (isOffline()) {
				// Don't attempt to sync while offline; just update the counter
				return;
			}
			const result = await syncOfflineInvoices();
			if (result && (result.synced || result.drafted)) {
				if (result.synced) {
					this.eventBus.emit("show_message", {
						title: `${result.synced} offline invoice${result.synced > 1 ? "s" : ""} synced`,
						color: "success",
					});
				}
				if (result.drafted) {
					this.eventBus.emit("show_message", {
						title: `${result.drafted} offline invoice${result.drafted > 1 ? "s" : ""} saved as draft`,
						color: "warning",
					});
				}
			}
			this.eventBus.emit("pending_invoices_changed", getPendingOfflineInvoiceCount());
		},
		get_print_formats() {
			frappe.call({
				method: "posawesome.posawesome.api.print_formats.get_print_formats",
				args: {
					doctype: "Sales Invoice",
				},
				callback: (r) => {
					this.print_formats = r.message;
				},
			});
		},
		set_print_format() {
			this.print_format = "";
			if (this.pos_profile.posa_print_format_rules && this.customer_info) {
				const rule = this.pos_profile.posa_print_format_rules.find(
					(r) => r.customer_group === this.customer_info.customer_group,
				);
				if (rule) {
					this.print_format = rule.print_format;
				}
			}
		},
	},
	// Lifecycle hook: created
	created() {
		// Register keyboard shortcut for payment
		this._shortcutHandlers = this._shortcutHandlers || {};
		this._shortcutHandlers.handlePaymentShortcut = this.handlePaymentShortcut.bind(this);
		document.addEventListener("keydown", this._shortcutHandlers.handlePaymentShortcut);
		this.syncPendingInvoices();
		this.eventBus.on("network-online", this.syncPendingInvoices);
		// Also sync when the server connection is re-established
		this.eventBus.on("server-online", this.syncPendingInvoices);
	},
	// Lifecycle hook: mounted
	mounted() {
		this.$nextTick(() => {
			// Listen to various event bus events for POS actions
			this.eventBus.on("send_invoice_doc_payment", (invoice_doc) => {
				this.invoice_doc = invoice_doc;
				const default_payment = this.invoice_doc.payments.find((payment) => payment.default === 1);
				const hasReturnPayments = this.invoice_doc.payments.some(
					(payment) => Math.abs(this.flt(payment.amount || 0, this.currency_precision)) > 0,
				);
				// is_credit_sale is now auto-detected - no need to reset manually
				this.is_write_off_change = false;
				if (invoice_doc.is_return) {
					this.is_return = true;
					this.is_credit_return = false;
					if (!hasReturnPayments) {
						// Reset all payment amounts to zero for returns
						invoice_doc.payments.forEach((payment) => {
							payment.amount = 0;
							payment.base_amount = 0;
						});
						// Set default payment to negative amount for returns
						if (default_payment) {
							const amount = invoice_doc.rounded_total || invoice_doc.grand_total;
							default_payment.amount = -Math.abs(amount);
							if (default_payment.base_amount !== undefined) {
								default_payment.base_amount = -Math.abs(amount);
							}
						}
					} else {
						this.ensureReturnPaymentsAreNegative();
					}
				} else if (default_payment) {
					// For regular invoices, set positive amount
					default_payment.amount = this.flt(
						invoice_doc.rounded_total || invoice_doc.grand_total,
						this.currency_precision,
					);
					this.is_credit_return = false;
				}
				this.initializeReturnValidity(invoice_doc);
				this.loyalty_amount = 0;
				this.redeemed_customer_credit = 0;
				// Only get addresses if customer exists
				if (invoice_doc.customer) {
					this.get_addresses();
				}
				this.get_sales_person_names();
			});
			this.eventBus.on("register_pos_profile", (data) => {
				this.pos_profile = data.pos_profile;
				this.stock_settings = data.stock_settings || {};
				this.get_mpesa_modes();
				this.get_print_formats();
			});
			this.eventBus.on("add_the_new_address", (data) => {
				const normalized = this.normalizeAddress(data);
				if (normalized) {
					const existing = this.addresses.filter((addr) => addr.name !== normalized.name);
					this.addresses = [...existing, normalized];
					if (this.invoice_doc) {
						this.invoice_doc.shipping_address_name = normalized.name;
					}
				}
			});
			this.eventBus.on("update_invoice_type", (data) => {
				this.invoiceType = data;
				if (this.invoice_doc && data !== "Order") {
					this.invoice_doc.posa_delivery_date = null;
					this.invoice_doc.posa_notes = null;
					this.invoice_doc.posa_authorization_code = null;
					this.invoice_doc.shipping_address_name = null;
				} else if (this.invoice_doc && data === "Order") {
					// Initialize delivery date to today when switching to Order type
					this.new_delivery_date = this.formatDateDisplay(frappe.datetime.now_date());
					this.update_delivery_date();
				}
				// Handle return invoices properly
				if (this.invoice_doc && data === "Return") {
					this.invoice_doc.is_return = 1;
					// Ensure payments are negative for returns
					this.ensureReturnPaymentsAreNegative();
					this.is_credit_return = false;
					this.return_valid_upto_date = null;
				}
			});
			this.eventBus.on("set_pos_settings", (data) => {
				this.pos_settings = data || {};
				if (this.invoice_doc && !this.invoice_doc.is_return) {
					this.initializeReturnValidity(this.invoice_doc);
				}
			});
			this.eventBus.on("set_mpesa_payment", (data) => {
				this.set_mpesa_payment(data);
			});
			this.eventBus.on("submit_payment_shortcut", this.handleSubmitPaymentShortcut);
			// Clear any stored invoice when parent emits clear_invoice
			this.eventBus.on("clear_invoice", () => {
				this.invoice_doc = "";
				this.is_return = false;
				this.is_credit_return = false;
				this.return_valid_upto_date = null;
			});
			// Scroll to top when payment view is shown
			this.eventBus.on("show_payment", this.handleShowPayment);
		});
	},
	// Lifecycle hook: beforeUnmount
	beforeUnmount() {
		// Remove all event listeners
		this.eventBus.off("send_invoice_doc_payment");
		this.eventBus.off("register_pos_profile");
		this.eventBus.off("add_the_new_address");
		this.eventBus.off("update_invoice_type");
		this.eventBus.off("set_pos_settings");
		this.eventBus.off("set_mpesa_payment");
		this.eventBus.off("submit_payment_shortcut", this.handleSubmitPaymentShortcut);
		this.eventBus.off("clear_invoice");
		this.eventBus.off("network-online", this.syncPendingInvoices);
		this.eventBus.off("server-online", this.syncPendingInvoices);
		this.eventBus.off("show_payment", this.handleShowPayment);
		this.clearBackgroundStatusCheck();
	},
	// Lifecycle hook: unmounted
	unmounted() {
		// Remove keyboard shortcut listener
		if (!this._shortcutHandlers) {
			return;
		}
		document.removeEventListener("keydown", this._shortcutHandlers.handlePaymentShortcut);
		this._shortcutHandlers = {};
	},
};
</script>

<style scoped>
/* ══════════════════════════════════════════════════════════════
   MODERN POS PAYMENT PROCESSING - Clean, Professional UI
   Supports both light and dark themes via CSS custom properties
   ══════════════════════════════════════════════════════════════ */

/* Root container */
.pay-root {
	display: flex;
	flex-direction: column;
	height: 100%;
	padding: 0;
}

/* Main scrollable card */
.pay-card {
	flex: 1;
	display: flex;
	flex-direction: column;
	border-radius: 16px !important;
	margin-top: 12px;
	max-height: 68vh;
	height: 68vh;
	overflow: hidden;
	background: var(--pos-card-bg, #ffffff) !important;
	border: 1px solid var(--pos-border-light, rgba(0,0,0,0.06));
	box-shadow: 0 1px 3px var(--pos-shadow-light, rgba(0,0,0,0.05)),
	            0 4px 12px var(--pos-shadow-light, rgba(0,0,0,0.04)) !important;
}

.pay-scroll {
	overflow-y: auto;
	overflow-x: hidden;
	padding: 16px;
	flex: 1;
}

.pay-scroll::-webkit-scrollbar {
	width: 4px;
}
.pay-scroll::-webkit-scrollbar-thumb {
	background: var(--pos-border, rgba(0,0,0,0.12));
	border-radius: 4px;
}

/* ─── SECTION BLOCKS ─── */
.pay-section {
	margin-bottom: 16px;
}

.pay-section-title {
	display: flex;
	align-items: center;
	font-size: 13px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	color: var(--pos-text-secondary, #666);
	margin-bottom: 12px;
	padding-bottom: 8px;
	border-bottom: 1px solid var(--pos-border-light, rgba(0,0,0,0.06));
}

/* ─── PAYMENT METHODS GRID ─── */
.pay-methods-grid {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.pay-method-card {
	background: var(--pos-surface-variant, #f5f5f5);
	border: 1.5px solid var(--pos-border-light, rgba(0,0,0,0.08));
	border-radius: 12px;
	padding: 14px 16px;
	transition: all 0.2s ease;
}

.pay-method-card:hover {
	border-color: var(--pos-primary, #0097a7);
	box-shadow: 0 2px 8px var(--pos-shadow-light, rgba(0,0,0,0.06));
}

.pay-method-active {
	border-color: var(--pos-primary, #0097a7) !important;
	background: var(--pos-primary-container, #e0f7fa);
}

.pay-method-header {
	display: flex;
	align-items: center;
	margin-bottom: 10px;
}

.pay-method-icon {
	color: var(--pos-primary, #0097a7);
}

.pay-method-name {
	font-size: 14px;
	font-weight: 600;
	color: var(--pos-text-primary, #212121);
}

.pay-fill-btn {
	min-width: 80px !important;
	font-size: 12px !important;
	text-transform: none !important;
	letter-spacing: 0 !important;
	height: 32px !important;
}

.pay-method-input-wrap {
	margin-top: 4px;
}

.pay-method-action-btn {
	text-transform: none !important;
	letter-spacing: 0 !important;
	font-weight: 600;
	height: 40px !important;
}

/* ─── DENOMINATION CHIPS ─── */
.pay-denominations {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin-top: 10px;
	padding-top: 8px;
	border-top: 1px dashed var(--pos-border-light, rgba(0,0,0,0.08));
}

.pay-denom-chip {
	text-transform: none !important;
	letter-spacing: 0 !important;
	font-size: 12px !important;
	font-weight: 500;
	min-width: auto !important;
	height: 30px !important;
}

/* ─── AMOUNT INPUT FIELDS ─── */
.pay-amount-input :deep(.v-field) {
	border-radius: 10px !important;
}

.pay-amount-input :deep(.v-field__input) {
	font-size: 14px;
	font-weight: 500;
}

.pay-amount-input :deep(.v-label) {
	font-size: 12px;
}

.pay-inline-input :deep(.v-field) {
	min-height: 36px !important;
}

/* ─── PAYMENT SUMMARY BLOCK ─── */
.pay-summary-section {
	margin-bottom: 12px;
}

.pay-summary-block {
	background: var(--pos-surface-variant, #f8f9fa);
	border: 1px solid var(--pos-border-light, rgba(0,0,0,0.06));
	border-radius: 12px;
	padding: 14px 16px;
}

.pay-summary-row {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 6px 0;
}

.pay-summary-label {
	display: flex;
	align-items: center;
	font-size: 13px;
	font-weight: 400;
	color: var(--pos-text-secondary, #666);
}

.pay-summary-value {
	font-size: 14px;
	font-weight: 600;
	color: var(--pos-text-primary, #212121);
	text-align: right;
}

.pay-summary-grand {
	padding: 8px 0;
}

.pay-summary-grand .pay-summary-label {
	font-size: 15px;
	font-weight: 700;
	color: var(--pos-text-primary, #212121);
}

.pay-summary-grand .pay-summary-value {
	font-size: 18px;
	font-weight: 800;
	color: var(--pos-text-primary, #212121);
}

.pay-summary-paid {
	cursor: pointer;
	border-radius: 8px;
	padding: 6px 8px;
	margin: 0 -8px;
	transition: background 0.15s;
}

.pay-summary-paid:hover {
	background: var(--pos-success-container, #e8f5e8);
}

.pay-summary-outstanding {
	border-radius: 8px;
	padding: 6px 8px;
	margin: 0 -8px;
}

.pay-value-success {
	color: var(--pos-success, #4caf50) !important;
}

.pay-value-error {
	color: var(--pos-error, #e86674) !important;
}

.pay-summary-divider {
	height: 1px;
	background: var(--pos-border-light, rgba(0,0,0,0.06));
	margin: 4px 0;
}

/* ─── OPTIONS SECTION ─── */
.pay-options-section {
	margin-bottom: 8px;
}

.pay-switches-row {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 16px;
	margin: 8px 0;
}

.pay-switch {
	flex: 0 0 auto;
}

.pay-credit-options {
	margin-top: 8px;
	padding: 12px;
	background: var(--pos-surface-variant, #f5f5f5);
	border-radius: 10px;
	border: 1px solid var(--pos-border-light, rgba(0,0,0,0.06));
}

.pay-credit-details {
	margin-top: 8px;
}

.pay-credit-source {
	font-size: 13px;
	font-weight: 500;
	color: var(--pos-text-secondary, #666);
	padding: 8px 4px;
}

.pay-helper-text {
	font-size: 12px;
	color: var(--pos-text-secondary, #888);
	margin: 4px 0 6px;
}

.pay-helper-error {
	color: var(--pos-error, #e86674) !important;
}

/* ─── ACTION BUTTONS ─── */
.pay-actions {
	margin-top: 12px;
	padding: 0;
}

.pay-actions-row {
	margin-bottom: 0;
}

.pay-action-btn {
	text-transform: none !important;
	letter-spacing: 0.2px !important;
	font-weight: 700 !important;
	font-size: 15px !important;
	height: 52px !important;
	box-shadow: 0 2px 8px var(--pos-shadow, rgba(0,0,0,0.1)) !important;
}

.pay-action-btn:active {
	transform: scale(0.98);
}

.pay-submit-btn {
	position: relative;
}

.pay-submit-highlight {
	box-shadow: 0 0 0 4px rgb(var(--v-theme-primary)) !important;
	transition: box-shadow 0.3s ease-in-out;
}

.pay-cancel-btn {
	text-transform: none !important;
	letter-spacing: 0 !important;
	font-weight: 500 !important;
	font-size: 14px !important;
	height: 44px !important;
	color: var(--pos-error, #e86674) !important;
	border-color: var(--pos-error, #e86674) !important;
}

.pay-cancel-btn:hover {
	background: var(--pos-error-container, #fdeaea) !important;
}

/* ─── READONLY INPUT STYLES ─── */
.v-text-field--readonly {
	cursor: text;
}

.v-text-field--readonly:hover {
	background-color: transparent;
}

/* ─── RESPONSIVE TOUCH TARGETS ─── */
@media (max-width: 600px) {
	.pay-scroll {
		padding: 12px;
	}

	.pay-method-card {
		padding: 12px;
	}

	.pay-action-btn {
		height: 56px !important;
		font-size: 16px !important;
	}

	.pay-cancel-btn {
		height: 48px !important;
	}

	.pay-summary-grand .pay-summary-value {
		font-size: 16px;
	}
}

/* ─── DARK THEME ADJUSTMENTS ─── */
[data-theme="dark"] .pay-method-card {
	background: var(--pos-surface-variant, #373737);
	border-color: var(--pos-border, rgba(255,255,255,0.12));
}

[data-theme="dark"] .pay-method-active {
	background: var(--pos-primary-container, #003344);
	border-color: var(--pos-primary, #00d4ff) !important;
}

[data-theme="dark"] .pay-summary-block {
	background: var(--pos-surface-variant, #2d2d2d);
	border-color: var(--pos-border, rgba(255,255,255,0.12));
}

[data-theme="dark"] .pay-cancel-btn {
	color: var(--pos-error, #f44336) !important;
	border-color: var(--pos-error, #f44336) !important;
}

[data-theme="dark"] .pay-cancel-btn:hover {
	background: var(--pos-error-container, #c62828) !important;
}

[data-theme="dark"] .pay-credit-options {
	background: var(--pos-surface-variant, #373737);
	border-color: var(--pos-border, rgba(255,255,255,0.12));
}

[data-theme="dark"] .pay-summary-paid:hover {
	background: var(--pos-success-container, #2e7d32);
}
</style>
