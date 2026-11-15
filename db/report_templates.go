package db

import (
	"database/sql"
	"errors"
)

var ErrReportTemplateNotFound = errors.New("report template not found")

type ReportTemplate struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Body      string `json:"body"`
	IsDefault bool   `json:"is_default"`
}

func (d *DB) ListReportTemplates() ([]ReportTemplate, error) {
	rows, err := d.Query(`SELECT id,name,body,is_default FROM report_templates ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ReportTemplate{}
	for rows.Next() {
		var v ReportTemplate
		if err := rows.Scan(&v.ID, &v.Name, &v.Body, &v.IsDefault); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (d *DB) SaveReportTemplate(id int64, name, body string) (int64, error) {
	if id == 0 {
		err := d.QueryRow(`INSERT INTO report_templates(name,body) VALUES($1,$2) RETURNING id`, name, body).Scan(&id)
		return id, err
	}
	err := d.QueryRow(`UPDATE report_templates SET name=$2,body=$3 WHERE id=$1 RETURNING id`, id, name, body).Scan(&id)
	if err == sql.ErrNoRows {
		return 0, ErrReportTemplateNotFound
	}
	return id, err
}

// Serialize changes to the global selection, including deletion of that selection.
const reportTemplateDefaultLock int64 = 7337741037

func (d *DB) DeleteReportTemplate(id int64) error {
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`SELECT pg_advisory_xact_lock($1)`, reportTemplateDefaultLock); err != nil {
		return err
	}
	result, err := tx.Exec(`DELETE FROM report_templates WHERE id=$1`, id)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrReportTemplateNotFound
	}
	return tx.Commit()
}

func (d *DB) DefaultReportTemplate(id int64) error {
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`SELECT pg_advisory_xact_lock($1)`, reportTemplateDefaultLock); err != nil {
		return err
	}
	if id != 0 {
		var found int64
		if err = tx.QueryRow(`SELECT id FROM report_templates WHERE id=$1`, id).Scan(&found); err == sql.ErrNoRows {
			return ErrReportTemplateNotFound
		} else if err != nil {
			return err
		}
	}
	if _, err = tx.Exec(`UPDATE report_templates SET is_default=false WHERE is_default`); err != nil {
		return err
	}
	if id != 0 {
		if _, err = tx.Exec(`UPDATE report_templates SET is_default=true WHERE id=$1`, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

type reportTemplateQuerier interface{ QueryRow(string, ...any) *sql.Row }

// One statement provides a consistent selection/body snapshot, including when
// another transaction changes or deletes the global default concurrently.
func resolveReportTemplate(q reportTemplateQuerier, id *int64) (string, error) {
	if id != nil && *id == 0 {
		return "", nil
	}
	var body string
	err := q.QueryRow(`SELECT body FROM report_templates WHERE CASE WHEN $1::bigint IS NULL THEN is_default ELSE id=$1 END`, id).Scan(&body)
	if err == sql.ErrNoRows {
		if id == nil {
			return "", nil
		}
		return "", ErrReportTemplateNotFound
	}
	return body, err
}

func (d *DB) ResolveReportTemplate(id *int64) (string, error) { return resolveReportTemplate(d, id) }

// An empty snapshot selects the built-in template, including historical tasks.
func (d *DB) TaskReportTemplate(taskID int64) (string, error) {
	var body string
	err := d.QueryRow(`SELECT report_template_body FROM tasks WHERE id=$1`, taskID).Scan(&body)
	return body, err
}
