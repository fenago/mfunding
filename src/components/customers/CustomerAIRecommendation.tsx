import { useState } from "react";
import {
  SparklesIcon,
  CpuChipIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ExclamationTriangleIcon,
  LightBulbIcon,
  ChatBubbleLeftRightIcon,
  ShieldExclamationIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import {
  generateCustomerRecommendation,
  CustomerRecommendation,
  CustomerProfile,
  GeminiModel,
} from "../../lib/gemini";

interface CustomerAIRecommendationProps {
  customer: CustomerProfile;
}

const GEMINI_MODELS: { value: GeminiModel; label: string }[] = [
  { value: "gemini-2.0-flash", label: "Flash (Fast)" },
  { value: "gemini-2.0-pro-exp", label: "Pro (Quality)" },
];

const PRODUCT_COLORS: Record<string, string> = {
  mca: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  term_loan: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  line_of_credit: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  equipment_financing: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  invoice_factoring: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  sba_loan: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  revenue_based: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
};

export default function CustomerAIRecommendation({ customer }: CustomerAIRecommendationProps) {
  const [recommendation, setRecommendation] = useState<CustomerRecommendation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<GeminiModel>("gemini-2.0-flash");
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    products: true,
    script: true,
    questions: false,
    objections: false,
    closing: false,
    redFlags: false,
    nextSteps: true,
  });
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleGenerate = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await generateCustomerRecommendation(customer, selectedModel);
      setRecommendation(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate recommendations");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      console.error("Failed to copy");
    }
  };

  const getFitScoreColor = (score: number) => {
    if (score >= 8) return "text-green-600 dark:text-green-400";
    if (score >= 5) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  const Section = ({
    id,
    title,
    icon: Icon,
    children,
  }: {
    id: string;
    title: string;
    icon: React.ElementType;
    children: React.ReactNode;
  }) => (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => toggleSection(id)}
        className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Icon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <span className="font-medium text-gray-900 dark:text-white">{title}</span>
        </div>
        {expandedSections[id] ? (
          <ChevronUpIcon className="w-5 h-5 text-gray-500" />
        ) : (
          <ChevronDownIcon className="w-5 h-5 text-gray-500" />
        )}
      </button>
      {expandedSections[id] && (
        <div className="p-4 bg-white dark:bg-gray-800/50">{children}</div>
      )}
    </div>
  );

  // Not yet generated
  if (!recommendation && !isLoading) {
    return (
      <div className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-xl p-6 border border-purple-200 dark:border-purple-700">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-purple-100 dark:bg-purple-900/50 rounded-lg">
            <SparklesIcon className="w-8 h-8 text-purple-600 dark:text-purple-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              AI Sales Recommendations
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Generate personalized product recommendations, sales scripts, and discovery questions
              tailored to this customer's profile and needs.
            </p>

            <div className="flex items-center gap-3">
              <button
                onClick={handleGenerate}
                className="btn-primary flex items-center gap-2"
              >
                <SparklesIcon className="w-4 h-4" />
                Generate Recommendations
              </button>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowModelSelect(!showModelSelect)}
                  className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                  title="Select AI Model"
                >
                  <CpuChipIcon className="w-5 h-5" />
                </button>

                {showModelSelect && (
                  <div className="absolute top-full right-0 mt-1 w-40 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-10">
                    {GEMINI_MODELS.map((model) => (
                      <button
                        key={model.value}
                        onClick={() => {
                          setSelectedModel(model.value);
                          setShowModelSelect(false);
                        }}
                        className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 first:rounded-t-lg last:rounded-b-lg ${
                          selectedModel === model.value
                            ? "bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                            : "text-gray-700 dark:text-gray-300"
                        }`}
                      >
                        {model.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {error && (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-8 border border-gray-200 dark:border-gray-700">
        <div className="flex flex-col items-center justify-center">
          <div className="relative">
            <SparklesIcon className="w-12 h-12 text-purple-500 animate-pulse" />
            <div className="absolute inset-0 animate-spin">
              <div className="w-12 h-12 border-2 border-purple-500 border-t-transparent rounded-full"></div>
            </div>
          </div>
          <p className="mt-4 text-gray-600 dark:text-gray-400 font-medium">
            Analyzing customer profile...
          </p>
          <p className="text-sm text-gray-500 mt-1">
            Generating personalized recommendations
          </p>
        </div>
      </div>
    );
  }

  // Recommendation results
  return (
    <div className="space-y-4">
      {/* Header with regenerate */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SparklesIcon className="w-5 h-5 text-purple-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white">
            AI Recommendations
          </h3>
        </div>
        <button
          onClick={handleGenerate}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <ArrowPathIcon className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          Regenerate
        </button>
      </div>

      {/* Summary */}
      <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 border border-purple-200 dark:border-purple-700">
        <p className="text-gray-800 dark:text-gray-200">{recommendation?.summary}</p>
      </div>

      {/* Recommended Products */}
      <Section id="products" title="Recommended Products" icon={LightBulbIcon}>
        <div className="space-y-3">
          {recommendation?.recommended_products.map((product, index) => (
            <div
              key={index}
              className="flex items-start gap-4 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg"
            >
              <div className="flex-shrink-0 text-center">
                <div className={`text-2xl font-bold ${getFitScoreColor(product.fit_score)}`}>
                  {product.fit_score}
                </div>
                <div className="text-xs text-gray-500">/10</div>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      PRODUCT_COLORS[product.product_type] || "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {product.product_name}
                  </span>
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300">{product.reasoning}</p>
                {product.typical_terms && (
                  <p className="text-xs text-gray-500 mt-1">
                    <span className="font-medium">Typical terms:</span> {product.typical_terms}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Opening Script */}
      <Section id="script" title="Opening Script" icon={ChatBubbleLeftRightIcon}>
        <div className="relative">
          <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg italic text-gray-700 dark:text-gray-300">
            "{recommendation?.opening_script}"
          </div>
          <button
            onClick={() => copyToClipboard(recommendation?.opening_script || "", "script")}
            className="absolute top-2 right-2 p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
            title="Copy to clipboard"
          >
            {copiedField === "script" ? (
              <CheckIcon className="w-4 h-4 text-green-500" />
            ) : (
              <ClipboardDocumentIcon className="w-4 h-4" />
            )}
          </button>
        </div>
      </Section>

      {/* Discovery Questions */}
      <Section id="questions" title="Discovery Questions" icon={ChatBubbleLeftRightIcon}>
        <ul className="space-y-2">
          {recommendation?.discovery_questions.map((question, index) => (
            <li key={index} className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-ocean-blue text-white text-xs rounded-full">
                {index + 1}
              </span>
              <span className="text-gray-700 dark:text-gray-300">{question}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* Objection Handlers */}
      <Section id="objections" title="Objection Handlers" icon={ShieldExclamationIcon}>
        <div className="space-y-4">
          {recommendation?.objection_handlers.map((handler, index) => (
            <div key={index} className="border-l-4 border-ocean-blue pl-4">
              <p className="font-medium text-gray-900 dark:text-white mb-1">
                "{handler.objection}"
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                <span className="font-medium text-green-600 dark:text-green-400">Response: </span>
                {handler.response}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* Closing Approach */}
      <Section id="closing" title="Closing Approach" icon={ChatBubbleLeftRightIcon}>
        <p className="text-gray-700 dark:text-gray-300">{recommendation?.closing_approach}</p>
      </Section>

      {/* Red Flags */}
      {recommendation?.red_flags && recommendation.red_flags.length > 0 && (
        <Section id="redFlags" title="Red Flags & Concerns" icon={ExclamationTriangleIcon}>
          <ul className="space-y-2">
            {recommendation.red_flags.map((flag, index) => (
              <li key={index} className="flex items-start gap-2">
                <ExclamationTriangleIcon className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <span className="text-gray-700 dark:text-gray-300">{flag}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Next Steps */}
      <Section id="nextSteps" title="Recommended Next Steps" icon={LightBulbIcon}>
        <ol className="space-y-2">
          {recommendation?.next_steps.map((step, index) => (
            <li key={index} className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-mint-green text-white text-xs rounded-full">
                {index + 1}
              </span>
              <span className="text-gray-700 dark:text-gray-300">{step}</span>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
