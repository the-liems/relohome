import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, BookOpen, Clock3, Search } from "lucide-react";
import { AppearanceControls, useUiPreferences } from "../uiPreferences";
import { guides } from "./content";
import { ServiceSuggestions } from "../components/ServiceSuggestions";
import "./guides.css";

const normalize = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();

export function GuidesPage({ standalone = false }: { standalone?: boolean }) {
  const { locale } = useUiPreferences();
  const t = (vi: string, en: string) => (locale === "en" ? en : vi);
  const [searchParams] = useSearchParams();
  const articleId = searchParams.get("article");
  const article = guides.find((item) => item.id === articleId);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const categories = Array.from(new Set(guides.map((item) => item.category)));
  const found = guides.filter((item) => {
    const matchesCategory = category === "all" || item.category === category;
    const matchesQuery = normalize([
      item.title, item.summary, item.category, item.lead, item.remember,
      ...item.sections.flatMap((section) => [section.heading, section.text, ...(section.checklist ?? [])]),
    ].join(" ")).includes(normalize(query.trim()));
    return matchesCategory && matchesQuery;
  });

  useEffect(() => {
    if (articleId) {
      window.scrollTo({ top: 0, behavior: "instant" });
      titleRef.current?.focus();
    }
  }, [articleId]);

  return (
    <div className={"guides-page " + (standalone ? "guides-standalone" : "")} data-service="guides">
      {standalone && (
        <header className="guides-public-header">
          <Link to="/">ReloHome</Link>
          <AppearanceControls />
        </header>
      )}
      {articleId ? (
        <>
          <nav className="guides-back" aria-label={t("Điều hướng cẩm nang", "Guide navigation")}>
            <Link to="/guides"><ArrowLeft size={18} aria-hidden="true" /> {t("Tất cả cẩm nang", "All guides")}</Link>
          </nav>
          {article ? (
            <article className="guides-reader">
              <header className="guides-reader-header">
                <span className="guides-kicker">{article.category} <span aria-hidden="true">·</span> {article.minutes} {t("phút đọc", "min read")}</span>
                <h1 ref={titleRef} tabIndex={-1}>{article.title}</h1>
                <p>{article.lead}</p>
              </header>
              <div className="guides-reader-layout">
                <nav className="guides-toc" aria-label={t("Trong bài viết", "On this page")}>
                  <span>{t("Trong bài viết", "On this page")}</span>
                  {article.sections.map((section, index) => <a key={section.heading} href={`#guide-section-${index}`}>{section.heading}</a>)}
                </nav>
                <div className="guides-reader-body">
                  {article.sections.map((section, index) => (
                    <section key={section.heading} id={`guide-section-${index}`}>
                      <h2>{section.heading}</h2>
                      <p>{section.text}</p>
                      {section.checklist && <ul>{section.checklist.map((point) => <li key={point}>{point}</li>)}</ul>}
                    </section>
                  ))}
                  <aside className="guides-remember">
                    <strong>{t("Điều cần nhớ", "Remember")}</strong>
                    <p>{article.remember}</p>
                  </aside>
                  <Link className="guides-next" to="/guides"><ArrowLeft size={16} aria-hidden="true" /> {t("Xem các cẩm nang khác", "Explore more guides")}</Link>
                  <ServiceSuggestions service="guides" />
                </div>
              </div>
            </article>
          ) : (
            <section className="guides-empty" role="status">
              <BookOpen size={24} aria-hidden="true" />
              <h1 ref={titleRef} tabIndex={-1}>{t("Không tìm thấy bài viết", "Guide not found")}</h1>
              <p>{t("Bài viết này không còn trong cẩm nang.", "This guide is no longer in the library.")}</p>
              <Link to="/guides">{t("Xem tất cả cẩm nang", "Browse all guides")}</Link>
            </section>
          )}
        </>
      ) : (
        <>
          <header className="guides-heading">
            <div>
              <span className="guides-kicker">RELOHOME · {t("CẨM NANG", "GUIDES")}</span>
              <h1>{t("Cẩm nang cuộc sống mới", "Guides for your next chapter")}</h1>
              <p>{t("Từ buổi xem phòng đầu tiên đến ngày nhận nhà: những điều nên biết để quyết định tự tin hơn.", "Practical guides for finding a home, planning costs and moving in with confidence.")}</p>
            </div>
            <Link className="secondary" to="/ai"><ArrowLeft size={16} aria-hidden="true" />{t("Về chat", "Back to chat")}</Link>
          </header>
          <div className="guides-toolbar">
            <label className="guides-search">
              <span>{t("Tìm trong cẩm nang", "Search guides")}</span>
              <div><Search size={18} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Thử: tiền điện, hợp đồng, đặt cọc…", "Try: electricity, leases, deposits…")} /></div>
            </label>
            <div className="guides-filters" role="group" aria-label={t("Lọc theo chủ đề", "Filter by topic")}>
              <button type="button" aria-pressed={category === "all"} onClick={() => setCategory("all")}>{t("Tất cả", "All")}</button>
              {categories.map((item) => <button type="button" key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}
            </div>
          </div>
          <p className="guides-count" role="status">{found.length} {t("bài viết · ReloHome biên soạn", "guides · Written by ReloHome")}{locale === "en" && <span> · Articles in Vietnamese</span>}</p>
          {found.length ? (
            <ul className="guides-list">
              {found.map((item, index) => <li key={item.id}>
                <article>
                  <div className="guides-card-top"><span className="guides-card-number">{String(index + 1).padStart(2, "0")}</span><span className="guides-card-category">{item.category}</span></div>
                  <h2><Link to={`/guides?article=${encodeURIComponent(item.id)}`}>{item.title}</Link></h2>
                  <p>{item.summary}</p>
                  <footer><span><Clock3 size={15} aria-hidden="true" /> {item.minutes} {t("phút đọc", "min read")}</span><Link to={`/guides?article=${encodeURIComponent(item.id)}`} aria-label={`${t("Đọc bài", "Read guide")}: ${item.title}`}>{t("Đọc bài", "Read guide")} <ArrowRight size={16} aria-hidden="true" /></Link></footer>
                </article>
              </li>)}
            </ul>
          ) : (
            <section className="guides-empty">
              <BookOpen size={24} aria-hidden="true" />
              <h2>{t("Chưa tìm thấy bài viết", "No articles found")}</h2>
              <p>{t("Thử từ khóa hoặc chủ đề khác để tiếp tục khám phá.", "Try a different keyword or topic.")}</p>
              <button type="button" className="secondary" onClick={() => { setQuery(""); setCategory("all"); }}>{t("Xem tất cả bài viết", "Show all articles")}</button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
